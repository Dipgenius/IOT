//script.js
let slideIndex = 0;
let ring = document.getElementById('progress-ring-circle');
let ringLength = 2 * Math.PI * 54;
ring.style.strokeDasharray = ringLength;
ring.style.strokeDashoffset = ringLength;
let timerLog = document.getElementById('timer-log');
let currentAction = null;

const socket = new WebSocket(`wss://${location.host}`);

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'relay') {
    document.getElementById('relay-status').textContent = `Bulb is ${data.state ? 'ON' : 'OFF'}`;
    document.getElementById('bulb').className = 'bulb ' + (data.state ? 'on' : 'off');
  }

  if (data.type === 'timer') {
    if (!data.active) {
      ring.style.strokeDashoffset = ringLength;
      timerLog.textContent = '';
    } else {
      const duration = data.duration * 60000;
      const endTime = data.endTime;
      currentAction = data.action;
      updateProgressRing(duration, endTime);
      timerLog.textContent = `Bulb will turn ${currentAction} in ${data.duration} min(s)`;
    }
  }

  if (data.type === 'motion') {
    const statusEl = document.getElementById('motion-status');
    statusEl.textContent = data.detected ? 'Motion Detected' : 'No motion';
    statusEl.className = data.detected ? 'motion-detected' : 'motion-none';
  }

  if (data.type === 'motionLog') {
    const logEl = document.getElementById('motion-log-list');
    logEl.innerHTML = '';
    (data.logs || []).slice(-10).reverse().forEach(entry => {
      const li = document.createElement('li');
      li.textContent = `${entry.time} - ${entry.event}`;
      logEl.appendChild(li);
    });
  }

  if (data.type === 'usage') {
    document.getElementById('total-usage-today').textContent = `Total Bulb ON Time (Today): ${data.totalUsageToday} hrs`;
    document.getElementById('energy-consumed').textContent = `Energy Consumed: ${data.energyConsumed} kWh`;
    // Billing line removed
  }
};

function toggleRelay() {
  fetch('relay/toggle');
}

function setTimer() {
  const minutes = document.getElementById('timerSelect').value;
  const action = document.getElementById('timerAction').value;
  if (!minutes || !action) return;
  fetch(`/setTimer?minutes=${minutes}&action=${action}`);
}

function cancelTimer() {
  fetch('/cancelTimer');
}

function navigate(dir) {
  slideIndex = (slideIndex + dir + 4) % 4;
  document.getElementById('slider').style.transform = `translateX(-${slideIndex * 100}vw)`;
}

function updateProgressRing(duration, endTime) {
  const update = () => {
    let now = Date.now();
    let remaining = endTime - now;
    let elapsed = duration - remaining;
    let offset = ringLength - (elapsed / duration) * ringLength;
    ring.style.strokeDashoffset = Math.max(offset, 0);
    if (remaining > 0) requestAnimationFrame(update);
  };
  update();
}



setInterval(fetchAndUpdateUsage, 30000);
window.addEventListener('load', fetchAndUpdateUsage);
