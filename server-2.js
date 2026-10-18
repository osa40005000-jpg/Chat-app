const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_FILE_MB = 50;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const HISTORY_FILE = path.join(__dirname, 'history.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

// ---------- سجل الرسائل (يتحفظ في ملف) ----------
let history = [];
try {
  history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
} catch (_) {
  history = [];
}
function saveHistory() {
  fs.writeFile(HISTORY_FILE, JSON.stringify(history.slice(-500)), () => {});
}
function addMessage(msg) {
  history.push(msg);
  if (history.length > 500) history = history.slice(-500);
  saveHistory();
  io.emit('message', msg);
}

// ---------- رفع الملفات ----------
const ALLOWED = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
};

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED[file.mimetype]) cb(null, true);
    else cb(new Error('نوع الملف غير مدعوم (صور وفيديو فقط)'));
  },
});

// الواجهة: بتشتغل سواء index.html جوه فولدر public أو جنب server.js مباشرة
const INDEX_FILE = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public', 'index.html')
  : path.join(__dirname, 'index.html');

app.get('/', (req, res) => res.sendFile(INDEX_FILE));
app.use('/uploads', express.static(UPLOAD_DIR));

app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `حجم الملف أكبر من ${MAX_FILE_MB} ميجا`
        : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'مفيش ملف' });

    const username = String(req.body.username || 'مجهول').slice(0, 30);
    const caption = String(req.body.caption || '').slice(0, 500);

    addMessage({
      id: crypto.randomUUID(),
      type: ALLOWED[req.file.mimetype], // image | video
      user: username,
      url: '/uploads/' + req.file.filename,
      text: caption,
      time: Date.now(),
    });
    res.json({ ok: true });
  });
});

// ---------- Socket.IO ----------
const online = new Map();

io.on('connection', (socket) => {
  socket.emit('history', history);

  socket.on('join', (name) => {
    const username = String(name || 'مجهول').slice(0, 30);
    online.set(socket.id, username);
    io.emit('online', [...online.values()]);
  });

  socket.on('text', ({ user, text }) => {
    text = String(text || '').trim().slice(0, 2000);
    if (!text) return;
    addMessage({
      id: crypto.randomUUID(),
      type: 'text',
      user: String(user || 'مجهول').slice(0, 30),
      text,
      time: Date.now(),
    });
  });

  socket.on('typing', (user) => {
    socket.broadcast.emit('typing', String(user || '').slice(0, 30));
  });

  socket.on('disconnect', () => {
    online.delete(socket.id);
    io.emit('online', [...online.values()]);
  });
});

server.listen(PORT, () => {
  console.log(`الشات شغّال على: http://localhost:${PORT}`);
});
