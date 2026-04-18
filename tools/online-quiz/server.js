const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');

const { initializeDatabase, teacherOps, quizOps, studentOps, cheatOps } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
let dbReady = false;
initializeDatabase().then(() => {
  dbReady = true;
  console.log('Database ready.');
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

app.use((req, res, next) => {
  if (!dbReady && req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'Server is starting up, please wait...' });
  }
  next();
});

// ============================================================
// Socket.io - Real-time student tracking
// ============================================================
const quizRooms = {}; // { quizId: Map<studentId, {socketId, name, status}> }

io.on('connection', (socket) => {
  // Teacher joins monitoring room
  socket.on('teacher-monitor', (quizId) => {
    socket.join(`quiz-${quizId}`);
    socket.join(`teacher-${quizId}`);
    // Send current student list
    if (quizRooms[quizId]) {
      const students = Array.from(quizRooms[quizId].values());
      socket.emit('current-students', students);
    }
  });

  // Teacher leaves monitoring
  socket.on('teacher-leave-monitor', (quizId) => {
    socket.leave(`quiz-${quizId}`);
    socket.leave(`teacher-${quizId}`);
  });

  // Student joins quiz
  socket.on('student-join', (data) => {
    const { studentId, quizId, studentName } = data;
    socket.join(`quiz-${quizId}`);
    socket.studentId = studentId;
    socket.quizId = quizId;
    socket.studentName = studentName;

    if (!quizRooms[quizId]) quizRooms[quizId] = new Map();
    quizRooms[quizId].set(studentId, {
      studentId,
      name: studentName,
      status: 'active',
      socketId: socket.id
    });

    // Notify teachers
    io.to(`teacher-${quizId}`).emit('student-joined', {
      studentId,
      studentName,
      status: 'active',
      activeCount: quizRooms[quizId].size
    });
  });

  // Student submits quiz
  socket.on('student-submit', (data) => {
    const { studentId, quizId, studentName, score } = data;
    if (quizRooms[quizId] && quizRooms[quizId].has(studentId)) {
      quizRooms[quizId].get(studentId).status = 'finished';
    }
    io.to(`teacher-${quizId}`).emit('student-submitted', {
      studentId,
      studentName,
      score,
      status: 'finished'
    });
  });

  // Cheat detected
  socket.on('cheat-detected', (data) => {
    const { studentId, quizId, studentName, eventType, cheatCount } = data;
    io.to(`teacher-${quizId}`).emit('cheat-alert', {
      studentId,
      studentName,
      eventType,
      cheatCount
    });
  });

  // Student blocked
  socket.on('student-blocked', (data) => {
    const { studentId, quizId, studentName } = data;
    if (quizRooms[quizId] && quizRooms[quizId].has(studentId)) {
      quizRooms[quizId].get(studentId).status = 'blocked';
    }
    io.to(`teacher-${quizId}`).emit('student-was-blocked', {
      studentId,
      studentName,
      status: 'blocked'
    });
  });

  socket.on('disconnect', () => {
    if (socket.quizId && socket.studentId) {
      if (quizRooms[socket.quizId]) {
        const entry = quizRooms[socket.quizId].get(socket.studentId);
        if (entry && entry.status === 'active') {
          // Mark as disconnected but don't remove yet
          entry.status = 'disconnected';
          io.to(`teacher-${socket.quizId}`).emit('student-disconnected', {
            studentId: socket.studentId,
            studentName: socket.studentName
          });
        }
        // Clean up finished/blocked students
        if (entry && (entry.status === 'finished' || entry.status === 'blocked')) {
          quizRooms[socket.quizId].delete(socket.studentId);
        }
      }
    }
  });
});

// ============================================================
// Auth API - Single entry point
// ============================================================
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const teacher = teacherOps.login(username, password);
    if (teacher) {
      return res.json({ success: true, role: 'teacher', teacher });
    }

    // Not a teacher - check if it could be a student entry
    // If username matches a teacher account but wrong password
    if (teacherOps.isTeacher(username)) {
      return res.status(401).json({ error: 'Invalid teacher password' });
    }

    // Not a teacher account at all - treat as invalid
    return res.status(401).json({ error: 'Invalid credentials. Teacher accounts: user1-user10' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student join (separate endpoint - name + access code)
app.post('/api/student/join', (req, res) => {
  try {
    const { name, access_code } = req.body;
    if (!name || !access_code) {
      return res.status(400).json({ error: 'Name and access code required' });
    }

    const quiz = quizOps.getByAccessCode(access_code.toUpperCase());
    if (!quiz) return res.status(404).json({ error: 'Quiz not found. Check your access code.' });
    if (!quiz.is_active) return res.status(403).json({ error: 'This quiz is currently disabled by the teacher.' });

    const student = studentOps.join(name, quiz.id);
    const questions = quizOps.getQuestions(quiz.id);

    // Remove correct answers - send safe questions to student
    const safeQuestions = questions.map(q => ({
      id: q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      options: JSON.parse(q.options),
      points: q.points,
      order_num: q.order_num
    }));

    res.json({
      success: true,
      student,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        display_mode: quiz.display_mode,
        show_scores: quiz.show_scores
      },
      questions: safeQuestions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Teacher Quiz API
// ============================================================

// Get teacher's quizzes
app.get('/api/teacher/:teacherId/quizzes', (req, res) => {
  try {
    const quizzes = quizOps.getByTeacher(parseInt(req.params.teacherId));
    res.json({ success: true, quizzes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create quiz
app.post('/api/quiz/create', (req, res) => {
  try {
    const { teacher_id, title, description, questions, settings } = req.body;
    if (!teacher_id || !title || !questions || questions.length === 0) {
      return res.status(400).json({ error: 'Teacher ID, title, and at least one question required' });
    }

    const accessCode = uuidv4().substring(0, 8).toUpperCase();
    const quizId = quizOps.create(teacher_id, title, description || '', accessCode, questions, settings || {});
    res.json({ success: true, quizId, accessCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get quiz details (for teacher)
app.get('/api/quiz/:id', (req, res) => {
  try {
    const quiz = quizOps.getById(parseInt(req.params.id));
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    const questions = quizOps.getQuestions(quiz.id);
    res.json({ success: true, quiz, questions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update quiz settings
app.put('/api/quiz/:id/settings', (req, res) => {
  try {
    const { teacher_id, settings } = req.body;
    const quiz = quizOps.updateSettings(parseInt(req.params.id), teacher_id, settings);
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update quiz questions (edit)
app.put('/api/quiz/:id/questions', (req, res) => {
  try {
    const { teacher_id, questions } = req.body;
    const updated = quizOps.updateQuestions(parseInt(req.params.id), teacher_id, questions);
    res.json({ success: true, questions: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Toggle quiz active status
app.put('/api/quiz/:id/toggle', (req, res) => {
  try {
    const { teacher_id } = req.body;
    const quiz = quizOps.toggleActive(parseInt(req.params.id), teacher_id);
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete quiz
app.delete('/api/quiz/:id', (req, res) => {
  try {
    const { teacher_id } = req.body;
    quizOps.delete(parseInt(req.params.id), teacher_id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get quiz results
app.get('/api/quiz/:id/results', (req, res) => {
  try {
    const quiz = quizOps.getById(parseInt(req.params.id));
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    const questions = quizOps.getQuestions(quiz.id);
    const results = studentOps.getResults(quiz.id);
    res.json({ success: true, quiz, questions, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get active students for a quiz (for live monitoring)
app.get('/api/quiz/:id/students', (req, res) => {
  try {
    const students = studentOps.getByQuiz(parseInt(req.params.id));
    res.json({ success: true, students });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export quiz results to Excel
app.get('/api/quiz/:id/export', (req, res) => {
  try {
    const quiz = quizOps.getById(parseInt(req.params.id));
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    const questions = quizOps.getQuestions(quiz.id);
    const results = studentOps.getResults(quiz.id);

    const wb = XLSX.utils.book_new();

    // Summary sheet
    const summaryData = results.map(student => ({
      'Student Name': student.name,
      'Status': student.status,
      'Score': student.score,
      'Total Points': student.total_points,
      'Percentage': student.total_points > 0 ? ((student.score / student.total_points) * 100).toFixed(1) + '%' : '0%',
      'Cheat Attempts': student.cheat_count,
      'Started At': student.started_at,
      'Submitted At': student.submitted_at || 'N/A'
    }));

    if (summaryData.length > 0) {
      const summarySheet = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    } else {
      const emptySheet = XLSX.utils.json_to_sheet([{ 'Note': 'No results yet' }]);
      XLSX.utils.book_append_sheet(wb, emptySheet, 'Summary');
    }

    // Detailed answers sheet
    const detailedData = [];
    results.forEach(student => {
      if (student.answers) {
        student.answers.forEach(answer => {
          detailedData.push({
            'Student Name': student.name,
            'Question': answer.question_text,
            'Type': answer.question_type,
            'Student Answer': JSON.parse(answer.answer || '[]').join(', '),
            'Correct Answer': JSON.parse(answer.correct_answers || '[]').join(', '),
            'Is Correct': answer.is_correct ? 'Yes' : 'No',
            'Points Earned': answer.points_earned,
            'Max Points': answer.points
          });
        });
      }
    });

    if (detailedData.length > 0) {
      const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
      XLSX.utils.book_append_sheet(wb, detailedSheet, 'Detailed Answers');
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="quiz_${quiz.id}_results.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Student API
// ============================================================

// Submit quiz
app.post('/api/student/:id/submit', (req, res) => {
  try {
    const studentId = parseInt(req.params.id);
    const { answers } = req.body;
    if (!answers) return res.status(400).json({ error: 'Answers required' });

    const result = studentOps.submitQuiz(studentId, answers);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Log cheat event
app.post('/api/student/:id/cheat', (req, res) => {
  try {
    const studentId = parseInt(req.params.id);
    const { event_type, details } = req.body;
    const cheatCount = cheatOps.log(studentId, event_type, details);

    const MAX_CHEAT = 3;
    if (cheatCount >= MAX_CHEAT) {
      studentOps.block(studentId);
      return res.json({ success: true, blocked: true, cheatCount, message: 'Blocked due to multiple cheating attempts.' });
    }

    res.json({ success: true, blocked: false, cheatCount, remaining: MAX_CHEAT - cheatCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get student status
app.get('/api/student/:id/status', (req, res) => {
  try {
    const student = studentOps.getById(parseInt(req.params.id));
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ success: true, student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Page Routes
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
});

app.get('/student/quiz', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

// ============================================================
// Start Server
// ============================================================
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  Online Quiz System v2.0`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  Teacher accounts: user1/account1 ... user10/account10`);
  console.log(`========================================\n`);
});
