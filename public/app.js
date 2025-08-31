const $ = s => document.querySelector(s);

/* =======================
   Configuración del juego
   ======================= */
const ROUND_SECONDS = 20; // ⏱️ tiempo por ronda (ajústalo a gusto)

let state = {
  round: 1,
  roundsTotal: 5,
  score: 0,
  current: { hour: 0, minute: 0 },
  locked: false,          // true cuando ya se contestó o se acabó el tiempo
  timerId: null,
  timeLeft: ROUND_SECONDS
};

function pad(n){ return String(n).padStart(2,"0"); }

/* =======================
   Reloj analógico (canvas)
   ======================= */
const canvas = document.getElementById("clock");
const ctx = canvas.getContext("2d");
const R = canvas.width/2;

function drawClock(h, m) {
  ctx.clearRect(0,0,canvas.width, canvas.height);
  ctx.save();
  ctx.translate(R, R);

  // esfera
  ctx.beginPath();
  ctx.arc(0,0,R-4,0,Math.PI*2);
  ctx.fillStyle = "#0e1530";
  ctx.fill();
  ctx.strokeStyle = "#233056";
  ctx.lineWidth = 4;
  ctx.stroke();

  // marcas horas
  ctx.strokeStyle = "#6ea8fe";
  ctx.lineWidth = 3;
  for (let i=0;i<12;i++){
    const ang = (i/12)*Math.PI*2;
    const r1 = R-18, r2 = R-36;
    ctx.beginPath();
    ctx.moveTo(r2*Math.cos(ang), r2*Math.sin(ang));
    ctx.lineTo(r1*Math.cos(ang), r1*Math.sin(ang));
    ctx.stroke();
  }

  // marcas minutos finas
  ctx.strokeStyle = "#2a355c";
  ctx.lineWidth = 2;
  for (let i=0;i<60;i++){
    if (i%5===0) continue;
    const ang = (i/60)*Math.PI*2;
    const r1 = R-20, r2 = R-28;
    ctx.beginPath();
    ctx.moveTo(r2*Math.cos(ang), r2*Math.sin(ang));
    ctx.lineTo(r1*Math.cos(ang), r1*Math.sin(ang));
    ctx.stroke();
  }

  // NÚMEROS 1..12
  ctx.fillStyle = "#e7eaf1";
  ctx.font = "700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const numR = R - 52;
  for (let i=1; i<=12; i++){
    const ang = (i/12)*Math.PI*2 - Math.PI/2;
    ctx.fillText(String(i), numR*Math.cos(ang), numR*Math.sin(ang));
  }

  // agujas
  const hourAngle = ((h%12) + m/60) * (Math.PI*2/12) - Math.PI/2;
  const minAngle = (m * (Math.PI*2/60)) - Math.PI/2;

  // hora
  ctx.strokeStyle = "#e7eaf1";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0,0);
  ctx.lineTo((R-90)*Math.cos(hourAngle), (R-90)*Math.sin(hourAngle));
  ctx.stroke();

  // minutos
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0,0);
  ctx.lineTo((R-55)*Math.cos(minAngle), (R-55)*Math.sin(minAngle));
  ctx.stroke();

  // centro
  ctx.fillStyle = "#e7eaf1";
  ctx.beginPath();
  ctx.arc(0,0,4,0,Math.PI*2);
  ctx.fill();

  ctx.restore();
}

/* ======
   API
   ====== */
async function apiRound() {
  const r = await fetch("/api/round");
  return r.json(); // {hour,minute}
}
async function apiCheck(guessText, hour, minute) {
  const r = await fetch("/api/check", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ guessText, hour, minute })
  });
  return r.json(); // {ok, parsed, target}
}
async function apiLeaderboard() {
  const r = await fetch("/api/leaderboard");
  return r.json();
}
async function apiSaveScore(name, score) {
  const r = await fetch("/api/score", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ name, score })
  });
  return r.json();
}

/* =======================
   Juego + Timer por ronda
   ======================= */
function updateTimerUI() {
  $("#timer").textContent = `${state.timeLeft}s`;
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function handleTimeUp() {
  // si ya está bloqueado (porque contestó), no hagas nada
  if (state.locked) return;
  state.locked = true;       // se acabó la ronda
  stopTimer();
  // marcar como fallo (0 puntos) y mostrar solución
  const { hour, minute } = state.current;
  $("#feedback").textContent = `⏰ Time’s up! It was ${fmtEnglish(hour, minute)}.`;
  // avanzar contador de ronda
  state.round += 1;
  $("#checkBtn").disabled = true;
  $("#guess").disabled = true;
  $("#nextBtn").disabled = (state.round > state.roundsTotal);
  if (state.round > state.roundsTotal) {
    $("#feedback").textContent += ` Game over. Final score: ${state.score}/${state.roundsTotal}.`;
  }
}

function startTimer() {
  stopTimer();
  state.timeLeft = ROUND_SECONDS;
  updateTimerUI();
  state.timerId = setInterval(() => {
    state.timeLeft -= 1;
    updateTimerUI();
    if (state.timeLeft <= 0) handleTimeUp();
  }, 1000);
}

async function newGame() {
  state.round = 1;
  state.score = 0;
  $("#score").textContent = state.score;
  $("#feedback").textContent = "—";
  $("#nextBtn").disabled = true;
  $("#checkBtn").disabled = false;
  $("#guess").disabled = false;
  $("#guess").value = "";
  await nextRound(true);
}

async function nextRound(resetFeedback=false) {
  if (state.round > state.roundsTotal) {
    $("#feedback").textContent = `Game over. Final score: ${state.score}/${state.roundsTotal}.`;
    $("#checkBtn").disabled = true;
    $("#nextBtn").disabled = true;
    $("#guess").disabled = true;
    stopTimer();
    updateTimerUI();
    return;
  }
  const r = await apiRound();
  state.current.hour = r.hour;
  state.current.minute = r.minute;
  $("#round").textContent = `${state.round} / ${state.roundsTotal}`;
  drawClock(r.hour, r.minute);
  if (resetFeedback) $("#feedback").textContent = "—";
  $("#guess").value = "";
  $("#guess").disabled = false;
  $("#guess").focus();
  state.locked = false;
  $("#checkBtn").disabled = false;
  $("#nextBtn").disabled = true;

  startTimer(); // ⏱️ arranca el contador para esta ronda
}

async function check() {
  if (state.locked) return; // evita doble click
  const guessText = $("#guess").value.trim();
  if (!guessText) { $("#guess").focus(); return; }
  // bloquea, corta timer y evalúa
  state.locked = true;
  stopTimer();

  const { hour, minute } = state.current;
  const res = await apiCheck(guessText, hour, minute);

  if (res.ok) {
    state.score += 1;
    $("#score").textContent = state.score;
    $("#feedback").textContent = `✅ Correct! It was ${fmtEnglish(hour, minute)}.`;
  } else {
    $("#feedback").textContent = `❌ Not quite. It was ${fmtEnglish(hour, minute)}.`;
  }

  // avanza ronda
  state.round += 1;
  $("#checkBtn").disabled = true;
  $("#guess").disabled = true;
  $("#nextBtn").disabled = (state.round > state.roundsTotal);
  if (state.round > state.roundsTotal) {
    $("#feedback").textContent += ` Game over. Final score: ${state.score}/${state.roundsTotal}.`;
  }
}

function fmtEnglish(h24, m) {
  const ap = h24 < 12 ? "am" : "pm";
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;
  const mm = pad(m);
  return `${h12}:${mm} ${ap}`;
}

/* =======================
   Leaderboard
   ======================= */
async function loadLeaderboard() {
  const list = await apiLeaderboard();
  const tb = $("#lbBody");
  tb.innerHTML = "";
  list.forEach((row,i)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(row.name)}</td><td>${row.score}</td>`;
    tb.appendChild(tr);
  });
}
async function saveScore() {
  if (state.round <= state.roundsTotal) {
    alert("Finish the 5 rounds first.");
    return;
  }
  const name = $("#name").value.trim() || "Anonymous";
  const r = await apiSaveScore(name, state.score);
  if (r.ok) { $("#name").value = ""; await loadLeaderboard(); }
}

/* =======================
   Utils & eventos
   ======================= */
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

// Clicks
$("#checkBtn").addEventListener("click", check);
$("#nextBtn").addEventListener("click", ()=>nextRound(true));
$("#newGameBtn").addEventListener("click", newGame);
$("#saveBtn").addEventListener("click", saveScore);

// Enter para enviar si el botón está activo
$("#guess").addEventListener("keydown", (e)=>{
  if (e.key === "Enter" && !$("#checkBtn").disabled) check();
});

// Init
loadLeaderboard();
newGame();