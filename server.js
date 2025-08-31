import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// === Utilidades de hora y generación de rondas ===
function randomMinute() {
  // elegimos múltiplos de 5 para facilitar expresiones en inglés
  const steps = [0,5,10,15,20,25,30,35,40,45,50,55];
  return steps[Math.floor(Math.random() * steps.length)];
}
function genRound() {
  const hour = Math.floor(Math.random() * 24); // 0..23
  const minute = randomMinute();               // 0..55 (x5)
  return { hour, minute };
}

// === Parser de la hora en inglés ===
// Acepta: "quarter past three", "half past five",
// "[minutes] past/to [hour]", "three fifteen", "3:15 pm",
// "twelve o'clock", "noon", "midnight", "3 pm", etc.
// Comparación: NO exige AM/PM (se acepta acierto por hora/minuto en 12h).
const NUMS = {
  "zero":0,"oh":0,"one":1,"two":2,"three":3,"four":4,"five":5,
  "six":6,"seven":7,"eight":8,"nine":9,"ten":10,"eleven":11,"twelve":12,
  "thirteen":13,"fourteen":14,"fifteen":15,"sixteen":16,"seventeen":17,"eighteen":18,"nineteen":19,
  "twenty":20,"thirty":30,"forty":40,"fifty":50
};
function parseNumberWord(w) {
  w = w.replace(/-/g," ").trim();
  if (NUMS[w] != null) return NUMS[w];
  const parts = w.split(/\s+/);
  let sum = 0;
  for (const p of parts) {
    if (NUMS[p] == null) return NaN;
    sum += NUMS[p];
  }
  return sum;
}
function parseMinuteWord(w) {
  if (w === "quarter" || w === "a quarter") return 15;
  if (w === "half") return 30;
  const n = parseNumberWord(w);
  return Number.isFinite(n) ? n : NaN;
}
function normalizeGuess(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\./g,"")      // quita puntos (a.m. -> am)
    .replace(/\s+/g," ")    // colapsa espacios
    .trim();
}
function to24(h12, ampm) {
  // h12: 1..12 (o 0/12)
  if (ampm === "am") {
    return (h12 % 12); // 12am => 0
  } else if (ampm === "pm") {
    return (h12 % 12) + 12; // 12pm => 12
  } else {
    // sin am/pm: devolvemos h12 tal cual (lo compararemos en 12h)
    return h12 % 12;
  }
}
function parseEnglishTime(str) {
  // Devuelve { ok, hour12, minute, ampm } o { ok:false, error }
  const s = normalizeGuess(str);

  if (!s) return { ok:false, error:"empty" };

  // Casos especiales
  if (s === "midnight") return { ok:true, hour12:12, minute:0, ampm:"am" }; // 00:00
  if (s === "noon")     return { ok:true, hour12:12, minute:0, ampm:"pm" }; // 12:00

  // AM/PM
  let ampm = null;
  if (/\b(am|a m)\b/.test(s)) ampm = "am";
  if (/\b(pm|p m)\b/.test(s)) ampm = "pm";
  const sNoAmPm = s.replace(/\b(a\s?m|p\s?m|am|pm)\b/g, "").trim();

  // Formatos numéricos: H:MM, H.MM, H, etc.
  let m;
  m = s.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/);
  if (m) {
    const hh = parseInt(m[1],10);
    const mm = parseInt(m[2],10);
    const ap = m[3] ? m[3].toLowerCase() : ampm;
    if (hh>=0 && hh<=23 && mm>=0 && mm<=59) {
      if (ap) {
        // si viene am/pm, convertimos a hora 12 + ampm consistente
        let h12 = hh % 12; if (h12 === 0) h12 = 12;
        return { ok:true, hour12:h12, minute:mm, ampm:ap };
      } else {
        // sin am/pm: llevamos a 12h, sin ampm
        let h12 = hh % 12; if (h12 === 0) h12 = 12;
        return { ok:true, hour12:h12, minute:mm, ampm:null };
      }
    }
  }
  // num + am/pm (e.g., "3 pm")
  m = s.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (m) {
    let hh = parseInt(m[1],10);
    const ap = m[2].toLowerCase();
    if (hh>=1 && hh<=12) {
      return { ok:true, hour12:hh, minute:0, ampm:ap };
    }
  }

  // X o'clock
  m = sNoAmPm.match(/^([a-z-]+)\s+o'?clock$/);
  if (m) {
    let hh = parseNumberWord(m[1]);
    if (Number.isFinite(hh) && hh>=0 && hh<=12) {
      if (hh === 0) hh = 12;
      return { ok:true, hour12:hh, minute:0, ampm };
    }
  }

  // half/quarter past/to H
  m = sNoAmPm.match(/^(half|quarter|a quarter)\s+(past|to)\s+([a-z-]+)$/);
  if (m) {
    const part = m[1];
    const dir  = m[2]; // past|to
    let h = parseNumberWord(m[3]); // 1..12
    if (!Number.isFinite(h) || h<0 || h>12) return { ok:false, error:"bad-hour" };
    if (h === 0) h = 12;
    let min = part === "half" ? 30 : 15;
    if (dir === "past") {
      return { ok:true, hour12:h, minute:min, ampm };
    } else {
      // to -> 60 - min, y la hora es la anterior
      const minute = 60 - min;
      let hour12 = h - 1; if (hour12 <= 0) hour12 = 12;
      return { ok:true, hour12, minute, ampm };
    }
  }

  // [minutes] past|to H
  m = sNoAmPm.match(/^([a-z-]+|\d+)\s+(past|to)\s+([a-z-]+|\d+)$/);
  if (m) {
    const minToken = m[1];
    const dir = m[2];
    const hToken = m[3];
    let mins = /^\d+$/.test(minToken) ? parseInt(minToken,10) : parseMinuteWord(minToken);
    let h = /^\d+$/.test(hToken) ? parseInt(hToken,10) : parseNumberWord(hToken);
    if (!Number.isFinite(mins) || mins<0 || mins>59) return { ok:false, error:"bad-min" };
    if (!Number.isFinite(h) || h<0 || h>12) return { ok:false, error:"bad-hour" };
    if (h === 0) h = 12;
    if (dir === "past") {
      return { ok:true, hour12:h, minute:mins, ampm };
    } else {
      const minute = 60 - mins;
      let hour12 = h - 1; if (hour12 <= 0) hour12 = 12;
      return { ok:true, hour12, minute, ampm };
    }
  }

  // H M (palabras: "three fifteen")
  m = sNoAmPm.match(/^([a-z-]+)\s+([a-z-]+)$/);
  if (m) {
    let h = parseNumberWord(m[1]);
    let mins = parseMinuteWord(m[2]);
    if (Number.isFinite(h) && h>=0 && h<=12 && Number.isFinite(mins) && mins>=0 && mins<=59) {
      if (h === 0) h = 12;
      return { ok:true, hour12:h, minute:mins, ampm };
    }
  }

  // último recurso: una sola palabra hora ("three") => xx:00
  m = sNoAmPm.match(/^([a-z-]+)$/);
  if (m) {
    let h = parseNumberWord(m[1]);
    if (Number.isFinite(h) && h>=0 && h<=12) {
      if (h === 0) h = 12;
      return { ok:true, hour12:h, minute:0, ampm };
    }
  }

  return { ok:false, error:"unrecognized" };
}

function isCorrect(guess, targetHour24, targetMinute) {
  // Convertimos target a 12h
  const targetH12 = ((targetHour24 % 12) || 12);
  // Acierto si coincide minuto y (hora en 12h)
  return guess.minute === targetMinute && guess.hour12 === targetH12;
}

// === "BD" JSON para leaderboard ===
const DB_PATH = path.join(__dirname, "scores.json");
async function readScores() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch { return []; }
}
async function writeScores(scores) {
  await fs.writeFile(DB_PATH, JSON.stringify(scores, null, 2), "utf-8");
}

// === API ===
app.get("/api/round", (_req, res) => {
  const r = genRound();
  res.json(r); // {hour,minute}
});

app.post("/api/check", (req, res) => {
  const { guessText, hour, minute } = req.body || {};
  if (typeof guessText !== "string" || hour == null || minute == null) {
    return res.status(400).json({ error: "Datos incompletos." });
  }
  const parsed = parseEnglishTime(guessText);
  if (!parsed.ok) {
    return res.json({ ok:false, reason: parsed.error });
  }
  const ok = isCorrect(parsed, Number(hour), Number(minute));
  res.json({ ok, parsed, target: { hour, minute } });
});

app.get("/api/leaderboard", async (_req, res) => {
  const scores = await readScores();
  res.json(scores.slice(0, 20));
});

app.post("/api/score", async (req, res) => {
  const { name, score } = req.body || {};
  if (!name || typeof score !== "number") {
    return res.status(400).json({ error: "Nombre y puntuación requeridos." });
  }
  const scores = await readScores();
  scores.push({ name: String(name).slice(0, 20), score, ts: Date.now() });
  // Ordena por score desc y luego más antiguo primero
  scores.sort((a, b) => b.score - a.score || a.ts - b.ts);
  await writeScores(scores.slice(0, 50));
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`▶️  Servidor iniciado en http://localhost:${PORT}`);
});