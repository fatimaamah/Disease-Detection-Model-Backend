import express from 'express';
import multer from 'multer';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(join(__dirname, 'uploads')));

const uploadsDir = join(__dirname, 'uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

const db = new sqlite3.Database(join(__dirname, 'disease_detection.db'), (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

function initDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS detection_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image1_name TEXT NOT NULL,
      image2_name TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    } else {
      console.log('Database table ready');
    }
  });
}

const simulatedResponses = [
  {
    status: 'healthy',
    title: 'Healthy',
    message: 'No disease detected. All crop samples appear normal and healthy.',
    confidence: 95,
    color: 'green'
  },
  {
    status: 'warning',
    title: 'Possible Disease Detected',
    message: 'Early signs of fungal infection detected. Recommend treatment intervention.',
    confidence: 78,
    color: 'yellow'
  },
  {
    status: 'critical',
    title: 'Critical Disease Identified',
    message: 'Severe disease markers detected. Immediate treatment recommended.',
    confidence: 88,
    color: 'red'
  },
  {
    status: 'mild',
    title: 'Minor Disease Indicators',
    message: 'Mild disease patterns detected. Monitor for progression.',
    confidence: 72,
    color: 'blue'
  },
  {
    status: 'moderate',
    title: 'Moderate Risk Detected',
    message: 'Moderate disease indicators present. Recommend specialist consultation.',
    confidence: 81,
    color: 'orange'
  }
];

const invalidImageResponses = [
  'Image quality too low for analysis',
  'Image appears to be synthetic or corrupted',
  'Unable to detect crop features in image',
  'Image dimensions incompatible with analysis model'
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidCropImage(file) {
  try {
    const stats = statSync(file.path);
    const fileSize = stats.size;

    const minSize = 50 * 1024;
    const maxSize = 10 * 1024 * 1024;

    if (fileSize < minSize || fileSize > maxSize) {
      return false;
    }

    const invalidChance = 0.15;
    if (Math.random() < invalidChance) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function getRandomResponse() {
  return simulatedResponses[Math.floor(Math.random() * simulatedResponses.length)];
}

function getRandomInvalidImageMessage() {
  return invalidImageResponses[Math.floor(Math.random() * invalidImageResponses.length)];
}

app.post('/api/detect', upload.array('images', 2), async (req, res) => {
  try {
    if (!req.files || req.files.length !== 2) {
      return res.status(400).json({
        success: false,
        error: 'Exactly 2 images are required for disease detection'
      });
    }

    const [image1, image2] = req.files;

    const image1Valid = isValidCropImage(image1);
    const image2Valid = isValidCropImage(image2);

    let result;
    let isInvalid = false;

    if (!image1Valid || !image2Valid) {
      isInvalid = true;
      result = {
        status: 'invalid',
        title: 'Invalid Image Detected',
        message: !image1Valid
          ? `Sample 1: ${getRandomInvalidImageMessage()}`
          : `Sample 2: ${getRandomInvalidImageMessage()}`,
        confidence: 0,
        color: 'red',
        processingSteps: [
          { step: 'Image Recognition', completed: true, duration: 3000 },
          { step: 'Crop Detection', completed: false, duration: 0 }
        ]
      };
    } else {
      result = getRandomResponse();
      result.processingSteps = [
        { step: 'Image Recognition', completed: true, duration: 3000 },
        { step: 'Crop Detection', completed: true, duration: 4000 },
        { step: 'Disease Analysis', completed: true, duration: 8000 }
      ];
    }

    const resultText = JSON.stringify(result);

    await sleep(isInvalid ? 7000 : 15000);

    db.run(
      'INSERT INTO detection_logs (image1_name, image2_name, result) VALUES (?, ?, ?)',
      [image1.filename, image2.filename, resultText],
      function(err) {
        if (err) {
          console.error('Error logging detection:', err);
          return res.status(500).json({
            success: false,
            error: 'Failed to log detection'
          });
        }

        res.json({
          success: true,
          data: {
            id: this.lastID,
            images: [
              `/uploads/${image1.filename}`,
              `/uploads/${image2.filename}`
            ],
            result: result,
            timestamp: new Date().toISOString()
          }
        });
      }
    );
  } catch (error) {
    console.error('Detection error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.get('/api/history', (req, res) => {
  db.all(
    'SELECT * FROM detection_logs ORDER BY created_at DESC LIMIT 10',
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch history'
        });
      }

      const history = rows.map(row => ({
        ...row,
        result: JSON.parse(row.result)
      }));

      res.json({
        success: true,
        data: history
      });
    }
  );
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Disease Detection API running on http://localhost:${PORT}`);
  console.log(`📊 Database: ${join(__dirname, 'disease_detection.db')}`);
  console.log(`📁 Uploads: ${uploadsDir}`);
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    }
    process.exit(0);
  });
});
