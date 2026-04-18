const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'quiz_system.db');

let db = null;

// ============================================================
// Hardcoded Teacher Accounts (user1/account1 ... user10/account10)
// ============================================================
const TEACHER_ACCOUNTS = [];
for (let i = 1; i <= 10; i++) {
  TEACHER_ACCOUNTS.push({ username: `user${i}`, password: `account${i}` });
}

// ============================================================
// Initialize Database
// ============================================================
async function initializeDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Teachers table
  db.run(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // Quizzes table with settings
  db.run(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      access_code TEXT UNIQUE NOT NULL,
      is_active INTEGER DEFAULT 1,
      show_scores INTEGER DEFAULT 1,
      display_mode TEXT DEFAULT 'scroll',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id)
    )
  `);

  // Questions table
  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL,
      options TEXT DEFAULT '[]',
      correct_answers TEXT NOT NULL DEFAULT '[]',
      points INTEGER DEFAULT 1,
      order_num INTEGER DEFAULT 0,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    )
  `);

  // Students table
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quiz_id INTEGER NOT NULL,
      status TEXT DEFAULT 'taking',
      score REAL DEFAULT 0,
      total_points INTEGER DEFAULT 0,
      cheat_count INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      submitted_at DATETIME,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id)
    )
  `);

  // Answers table
  db.run(`
    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      answer TEXT DEFAULT '[]',
      is_correct INTEGER DEFAULT 0,
      points_earned REAL DEFAULT 0,
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (question_id) REFERENCES questions(id)
    )
  `);

  // Cheat logs table
  db.run(`
    CREATE TABLE IF NOT EXISTS cheat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT DEFAULT '',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id)
    )
  `);

  // Seed hardcoded teacher accounts
  seedTeachers();

  saveDatabase();
  console.log('Database initialized successfully.');
}

function seedTeachers() {
  for (const acct of TEACHER_ACCOUNTS) {
    const existing = queryOne('SELECT id FROM teachers WHERE username = ?', [acct.username]);
    if (!existing) {
      runSql('INSERT INTO teachers (username, password) VALUES (?, ?)', [acct.username, acct.password]);
    }
  }
}

// ============================================================
// DB Helpers
// ============================================================
function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
}

function runInsert(sql, params = []) {
  db.run(sql, params);
  const stmt = db.prepare('SELECT last_insert_rowid() as id');
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  saveDatabase();
  return row ? row.id : null;
}

// ============================================================
// Teacher Operations
// ============================================================
const teacherOps = {
  login(username, password) {
    const teacher = queryOne('SELECT * FROM teachers WHERE username = ?', [username]);
    if (!teacher) return null;
    if (teacher.password !== password) return null;
    return { id: teacher.id, username: teacher.username };
  },

  getById(id) {
    return queryOne('SELECT id, username FROM teachers WHERE id = ?', [id]);
  },

  isTeacher(username) {
    return !!queryOne('SELECT id FROM teachers WHERE username = ?', [username]);
  }
};

// ============================================================
// Quiz Operations
// ============================================================
const quizOps = {
  create(teacherId, title, description, accessCode, questions, settings = {}) {
    const showScores = settings.show_scores !== undefined ? (settings.show_scores ? 1 : 0) : 1;
    const displayMode = settings.display_mode || 'scroll';

    const quizId = runInsert(
      'INSERT INTO quizzes (teacher_id, title, description, access_code, show_scores, display_mode) VALUES (?, ?, ?, ?, ?, ?)',
      [teacherId, title, description, accessCode, showScores, displayMode]
    );

    questions.forEach((q, index) => {
      runSql(
        'INSERT INTO questions (quiz_id, question_text, question_type, options, correct_answers, points, order_num) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          quizId,
          q.question_text,
          q.question_type,
          JSON.stringify(q.options || []),
          JSON.stringify(q.correct_answers || []),
          q.points || 1,
          index
        ]
      );
    });

    return quizId;
  },

  getById(id) {
    return queryOne('SELECT * FROM quizzes WHERE id = ?', [id]);
  },

  getByAccessCode(code) {
    return queryOne('SELECT * FROM quizzes WHERE access_code = ?', [code]);
  },

  getByTeacher(teacherId) {
    const quizzes = queryAll('SELECT * FROM quizzes WHERE teacher_id = ? ORDER BY created_at DESC', [teacherId]);
    return quizzes.map(q => {
      const questionCount = queryOne('SELECT COUNT(*) as cnt FROM questions WHERE quiz_id = ?', [q.id]);
      const studentCount = queryOne('SELECT COUNT(*) as cnt FROM students WHERE quiz_id = ?', [q.id]);
      const activeStudents = queryOne("SELECT COUNT(*) as cnt FROM students WHERE quiz_id = ? AND status = 'taking'", [q.id]);
      const completedStudents = queryOne("SELECT COUNT(*) as cnt FROM students WHERE quiz_id = ? AND status = 'completed'", [q.id]);
      const blockedStudents = queryOne("SELECT COUNT(*) as cnt FROM students WHERE quiz_id = ? AND status = 'blocked'", [q.id]);
      return {
        ...q,
        question_count: questionCount ? questionCount.cnt : 0,
        student_count: studentCount ? studentCount.cnt : 0,
        active_students: activeStudents ? activeStudents.cnt : 0,
        completed_students: completedStudents ? completedStudents.cnt : 0,
        blocked_students: blockedStudents ? blockedStudents.cnt : 0
      };
    });
  },

  getQuestions(quizId) {
    return queryAll('SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_num', [quizId]);
  },

  toggleActive(id, teacherId) {
    const quiz = queryOne('SELECT * FROM quizzes WHERE id = ? AND teacher_id = ?', [id, teacherId]);
    if (!quiz) throw new Error('Quiz not found');
    const newStatus = quiz.is_active ? 0 : 1;
    runSql('UPDATE quizzes SET is_active = ? WHERE id = ?', [newStatus, id]);
    return { ...quiz, is_active: newStatus };
  },

  updateSettings(id, teacherId, settings) {
    const quiz = queryOne('SELECT * FROM quizzes WHERE id = ? AND teacher_id = ?', [id, teacherId]);
    if (!quiz) throw new Error('Quiz not found');

    if (settings.title !== undefined) runSql('UPDATE quizzes SET title = ? WHERE id = ?', [settings.title, id]);
    if (settings.description !== undefined) runSql('UPDATE quizzes SET description = ? WHERE id = ?', [settings.description, id]);
    if (settings.show_scores !== undefined) runSql('UPDATE quizzes SET show_scores = ? WHERE id = ?', [settings.show_scores ? 1 : 0, id]);
    if (settings.display_mode !== undefined) runSql('UPDATE quizzes SET display_mode = ? WHERE id = ?', [settings.display_mode, id]);
    if (settings.access_code !== undefined) {
      const existing = queryOne('SELECT id FROM quizzes WHERE access_code = ? AND id != ?', [settings.access_code, id]);
      if (existing) throw new Error('Access code already in use');
      runSql('UPDATE quizzes SET access_code = ? WHERE id = ?', [settings.access_code, id]);
    }

    return quizOps.getById(id);
  },

  updateQuestions(quizId, teacherId, questions) {
    const quiz = queryOne('SELECT * FROM quizzes WHERE id = ? AND teacher_id = ?', [quizId, teacherId]);
    if (!quiz) throw new Error('Quiz not found');

    // Delete old questions
    runSql('DELETE FROM questions WHERE quiz_id = ?', [quizId]);

    // Insert new questions
    questions.forEach((q, index) => {
      runSql(
        'INSERT INTO questions (quiz_id, question_text, question_type, options, correct_answers, points, order_num) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          quizId,
          q.question_text,
          q.question_type,
          JSON.stringify(q.options || []),
          JSON.stringify(q.correct_answers || []),
          q.points || 1,
          index
        ]
      );
    });

    return quizOps.getQuestions(quizId);
  },

  delete(id, teacherId) {
    const quiz = queryOne('SELECT * FROM quizzes WHERE id = ? AND teacher_id = ?', [id, teacherId]);
    if (!quiz) throw new Error('Quiz not found');
    runSql('DELETE FROM answers WHERE student_id IN (SELECT id FROM students WHERE quiz_id = ?)', [id]);
    runSql('DELETE FROM cheat_logs WHERE student_id IN (SELECT id FROM students WHERE quiz_id = ?)', [id]);
    runSql('DELETE FROM students WHERE quiz_id = ?', [id]);
    runSql('DELETE FROM questions WHERE quiz_id = ?', [id]);
    runSql('DELETE FROM quizzes WHERE id = ?', [id]);
    return true;
  }
};

// ============================================================
// Student Operations
// ============================================================
const studentOps = {
  join(name, quizId) {
    const id = runInsert('INSERT INTO students (name, quiz_id) VALUES (?, ?)', [name, quizId]);
    return { id, name, quiz_id: quizId, status: 'taking' };
  },

  getById(id) {
    return queryOne('SELECT * FROM students WHERE id = ?', [id]);
  },

  getByQuiz(quizId) {
    return queryAll('SELECT * FROM students WHERE quiz_id = ? ORDER BY started_at DESC', [quizId]);
  },

  block(id) {
    runSql("UPDATE students SET status = 'blocked' WHERE id = ?", [id]);
  },

  submitQuiz(studentId, answersData) {
    const student = queryOne('SELECT * FROM students WHERE id = ?', [studentId]);
    if (!student) throw new Error('Student not found');
    if (student.status === 'blocked') throw new Error('Student is blocked due to cheating');
    if (student.status === 'completed') throw new Error('Quiz already submitted');

    const questions = queryAll('SELECT * FROM questions WHERE quiz_id = ?', [student.quiz_id]);

    let totalScore = 0;
    let totalPoints = 0;

    questions.forEach(question => {
      const studentAnswer = answersData.find(a => a.question_id === question.id);
      const answerValue = studentAnswer ? studentAnswer.answer : [];
      const correctAnswers = JSON.parse(question.correct_answers);

      let isCorrect = 0;
      let pointsEarned = 0;

      if (question.question_type === 'identification') {
        // Multiple correct answers allowed - student provides one answer
        const studentAns = (Array.isArray(answerValue) ? answerValue[0] : answerValue || '').toString().trim().toLowerCase();
        const isMatch = correctAnswers.some(ca => ca.toString().trim().toLowerCase() === studentAns);
        if (isMatch) {
          isCorrect = 1;
          pointsEarned = question.points;
        }
      } else if (question.question_type === 'multiple_choice') {
        // Single correct answer only
        const studentAns = (Array.isArray(answerValue) ? answerValue[0] : answerValue || '').toString().trim();
        const correctAns = correctAnswers[0] ? correctAnswers[0].toString().trim() : '';
        if (studentAns === correctAns) {
          isCorrect = 1;
          pointsEarned = question.points;
        }
      } else if (question.question_type === 'true_false') {
        const studentAns = (Array.isArray(answerValue) ? answerValue[0] : answerValue || '').toString().trim().toLowerCase();
        const correctAns = correctAnswers[0] ? correctAnswers[0].toString().trim().toLowerCase() : '';
        if (studentAns === correctAns) {
          isCorrect = 1;
          pointsEarned = question.points;
        }
      }

      totalScore += pointsEarned;
      totalPoints += question.points;

      runSql(
        'INSERT INTO answers (student_id, question_id, answer, is_correct, points_earned) VALUES (?, ?, ?, ?, ?)',
        [studentId, question.id, JSON.stringify(Array.isArray(answerValue) ? answerValue : [answerValue]), isCorrect, pointsEarned]
      );
    });

    runSql(
      "UPDATE students SET status = 'completed', score = ?, total_points = ?, submitted_at = datetime('now') WHERE id = ?",
      [totalScore, totalPoints, studentId]
    );

    return {
      score: totalScore,
      totalPoints,
      percentage: totalPoints > 0 ? ((totalScore / totalPoints) * 100).toFixed(1) : '0'
    };
  },

  getResults(quizId) {
    const students = queryAll('SELECT * FROM students WHERE quiz_id = ? ORDER BY submitted_at DESC', [quizId]);
    return students.map(student => {
      const answers = queryAll(`
        SELECT a.*, q.question_text, q.question_type, q.correct_answers, q.points
        FROM answers a
        JOIN questions q ON a.question_id = q.id
        WHERE a.student_id = ?
        ORDER BY q.order_num
      `, [student.id]);
      return { ...student, answers };
    });
  }
};

// ============================================================
// Cheat Log Operations
// ============================================================
const cheatOps = {
  log(studentId, eventType, details) {
    runSql('INSERT INTO cheat_logs (student_id, event_type, details) VALUES (?, ?, ?)', [studentId, eventType, details || '']);
    runSql('UPDATE students SET cheat_count = cheat_count + 1 WHERE id = ?', [studentId]);
    const student = queryOne('SELECT cheat_count FROM students WHERE id = ?', [studentId]);
    return student ? student.cheat_count : 0;
  }
};

module.exports = {
  initializeDatabase,
  teacherOps,
  quizOps,
  studentOps,
  cheatOps,
  TEACHER_ACCOUNTS
};
