const express = require('express');
const multer = require('multer');
const Groq = require('groq-sdk');
const fs = require('fs'); // Change this to regular fs
const fsPromises = require('fs').promises; // Keep promises version for async operations
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

app.use(cors());
app.use(express.json());

// Chat history (note: this will reset on server restart)
let chatHistory = [];

// Modified to read from file asynchronously
const getSystemRole = async () => {
  try {
    const rolePath = path.join(__dirname, 'system-role.txt');
    const role = await fsPromises.readFile(rolePath, 'utf8');
    return role.trim();
  } catch (error) {
    console.error('Error reading system role file:', error);
    return 'You are a helpful AI assistant.';
  }
};

app.post('/api/chat', async (req, res) => {
  try {
    const { text } = req.body;
    chatHistory.push({ role: 'user', content: text });

    const systemRole = await getSystemRole();

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemRole },
        ...chatHistory,
      ],
      model: 'llama3-8b-8192',
      temperature: 0.7,
      max_tokens: 1024,
    });

    const botMessage = completion.choices[0]?.message?.content;
    if (botMessage) {
      chatHistory.push({ role: 'assistant', content: botMessage });
      res.json({ message: botMessage });
    } else {
      res.status(500).json({ error: 'No AI response received' });
    }
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.post('/api/chat/voice', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Create a read stream using regular fs
    const fileStream = fs.createReadStream(req.file.path);

    // Transcribe audio
    const transcriptionResponse = await groq.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-large-v3-turbo',
      language: 'en',
      response_format: 'json',
      temperature: 0.0,
    });

    const userMessage = transcriptionResponse.text;
    chatHistory.push({ role: 'user', content: userMessage });

    const systemRole = await getSystemRole();

    // Get AI response
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemRole },
        ...chatHistory,
      ],
      model: 'llama3-8b-8192',
      temperature: 0.7,
      max_tokens: 1024,
    });

    const botMessage = completion.choices[0]?.message?.content;
    if (!botMessage) {
      return res.status(500).json({ error: 'No AI response received' });
    }

    chatHistory.push({ role: 'assistant', content: botMessage });

    // Generate speech from response
    const speechResponse = await axios({
      method: 'post',
      url: 'https://api.v7.unrealspeech.com/stream',
      headers: {
        Authorization: `Bearer ${process.env.UNREALSPEECH_API_KEY}`,
        'Content-Type': 'application/json',
      },
      data: {
        Text: botMessage,
        VoiceId: 'Dan',
        Bitrate: '192k',
        Speed: '0',
        Pitch: '1',
        Codec: 'libmp3lame',
      },
      responseType: 'arraybuffer',
    });

    const audioBase64 = Buffer.from(speechResponse.data).toString('base64');

    // Clean up temporary file using promises version
    await fsPromises.unlink(req.file.path);

    res.json({
      message: botMessage,
      audio: audioBase64,
      transcription: userMessage,
    });
  } catch (error) {
    console.error('API Error:', error);
    if (req.file) {
      await fsPromises.unlink(req.file.path).catch(console.error);
    }
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});