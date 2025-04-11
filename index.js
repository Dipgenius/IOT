const express = require('express');
const path = require('path');
const app = express();
const http = require('http');
const WebSocket = require('ws');
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const admin = require('firebase-admin');
const serviceAccount = require("./wired-dahlia-274916-firebase-adminsdk-zjw46-29cef5bf90.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

app.use(express.static(path.join(__dirname, 'public')));

let relayState = false;
let motionDetected = false;
let timer = null;
let timerAction = null;
let timerEnd = null;
let lastToggleTime = null;

const todayKey = () => new Date().toISOString().split('T')[0];

function calculateCost(kWh) {
  const units = kWh * 1000;
  let cost = 0;
  if (units <= 102) {
    cost = units * 3.68;
  } else if (units <= 192) {
    cost = (102 * 3.68) + ((units - 102) * 4.10);
  } else {
    cost = (102 * 3.68) + (90 * 4.10) + ((units - 192) * 5.0);
  }
  return cost;
}

async function logUsage(durationMs) {
  const date = todayKey();
  const docRef = db.collection('usageLogs').doc(date);
  const snapshot = await docRef.get();
  const existing = snapshot.exists ? snapshot.data().onTimeMs : 0;

  const updatedDuration = existing + durationMs;

  console.log(`[USAGE LOG] ${durationMs}ms added on ${date}. Total: ${updatedDuration}ms`);

  await docRef.set({ onTimeMs: updatedDuration }, { merge: true });
}

// Toggle relay endpoint
app.get('/relay/toggle', (req, res) => {
  relayState = !relayState;

  if (relayState) {
    lastToggleTime = Date.now();
    console.log('[TOGGLE] Bulb turned ON');
  } else if (lastToggleTime) {
    const durationMs = Date.now() - lastToggleTime;
    console.log(`[TOGGLE] Bulb turned OFF after ${durationMs / 1000}s`);
    logUsage(durationMs);
    lastToggleTime = null;
  }

  broadcast({ type: 'relay', state: relayState });
  res.sendStatus(200);
});

app.get('/setTimer', (req, res) => {
  const minutes = parseInt(req.query.minutes);
  const action = req.query.action;

  if (!minutes || !['on', 'off'].includes(action)) return res.sendStatus(400);

  timerAction = action;
  timerEnd = Date.now() + minutes * 60000;

  if (timer) clearTimeout(timer);

  timer = setTimeout(() => {
    if (timerAction === 'on') {
      relayState = true;
      lastToggleTime = Date.now();
      console.log('[TIMER] Bulb turned ON via timer');
    } else {
      relayState = false;
      if (lastToggleTime) {
        const durationMs = Date.now() - lastToggleTime;
        console.log(`[TIMER] Timer ended - Bulb OFF. Duration: ${durationMs / 1000}s`);
        logUsage(durationMs);
        lastToggleTime = null;
      } else {
        console.log('[TIMER] Bulb turned OFF via timer (no usage to log)');
      }
    }

    broadcast({ type: 'relay', state: relayState });
    broadcast({ type: 'timer', active: false });
    timer = null;
    timerEnd = null;
    timerAction = null;
  }, minutes * 60000);

  broadcast({ type: 'timer', active: true, duration: minutes, endTime: timerEnd });
  res.sendStatus(200);
});

app.get('/cancelTimer', (req, res) => {
  clearTimeout(timer);
  timer = null;
  timerEnd = null;
  timerAction = null;
  console.log('[TIMER] Timer cancelled');
  broadcast({ type: 'timer', active: false });
  res.sendStatus(200);
});

app.get('/usageStats', async (req, res) => {
  const today = todayKey();
  const snapshot = await db.collection('usageLogs').get();
  let totalUsageToday = 0;

  snapshot.forEach(doc => {
    const ms = doc.data().onTimeMs || 0;
    totalUsageToday += ms;
  });

  const totalHours = totalUsageToday / 3600000;
  const energy = (totalHours * 9) / 1000;
  const cost = calculateCost(energy);

  console.log(`[USAGE STATS] Total hours: ${totalHours}, kWh: ${energy}, Cost: ₹${cost}`);

  res.json({
    totalUsageToday: totalHours.toFixed(2),
    energyConsumed: energy.toFixed(3),
    totalCost: cost.toFixed(2)
  });
});

function broadcast(data) {
  const json = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(json);
  });
}

setInterval(() => {
  motionDetected = Math.random() > 0.5;
  broadcast({ type: 'motion', detected: motionDetected });
}, 3000);

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'relay', state: relayState }));
  ws.send(JSON.stringify({ type: 'motion', detected: motionDetected }));
  if (timer && timerEnd) {
    const duration = Math.round((timerEnd - Date.now()) / 60000);
    ws.send(JSON.stringify({ type: 'timer', active: true, duration, endTime: timerEnd, action: timerAction }));
  } else {
    ws.send(JSON.stringify({ type: 'timer', active: false }));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
