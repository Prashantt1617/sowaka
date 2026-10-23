#!/usr/bin/env node
/**
 * Builds the Diwali Cup's one uploadable file:
 *
 *   cup/page.html  +  cup/play.js  →  game-pages/diwali-cup.html
 *
 *   node backend/game-pages/cup/build.mjs [--play <path to play.js>]
 *
 * play.js (the match itself, window.CupPlay) goes where page.html says
 * `/*@CUP_PLAY@*\/`. Until play.js exists a stub stands in: a tap-to-score
 * placeholder with the same start() contract, so the page can be tried end to
 * end. The build refuses a file over 250 KB.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = process.argv.indexOf('--play');
const playPath = arg > 0 ? resolve(process.argv[arg + 1]) : join(here, 'play.js');
const out = join(here, '..', 'diwali-cup.html');
const LIMIT = 250 * 1024;

/** Stands in for play.js: same contract, a placeholder board. */
const STUB = `/* STUB: cup/play.js is not built yet. A placeholder round with the CupPlay contract. */
window.CupPlay = window.CupPlay || { stub: true, start: function (o) {
  var m = o.mount, roundMs = (o.roundSec || 45) * 1000, off = (o.serverNow || Date.now()) - Date.now();
  var start = Number(o.startAt) || Date.now() + 3000, score = 0, done = false, lastLive = 0;
  var now = function () { return Date.now() + off; };
  m.innerHTML = '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center;font-family:inherit">' +
    '<p style="margin:0;font-weight:800;letter-spacing:1px;color:#B9B2D9;font-size:12px">PLACEHOLDER ROUND · BOARD ' + String(o.boardSeed || '').replace(/[<>&]/g, '') + '</p>' +
    '<div data-t style="font-family:Lilita One,system-ui;font-size:64px;color:#F5B82E;line-height:1">0:00</div>' +
    '<div style="display:flex;gap:28px;font-weight:800"><span>You <b data-s style="font-family:Lilita One;font-size:30px;display:block">0</b></span><span>' + String((o.opponent && o.opponent.name) || 'Opponent').replace(/[<>&]/g, '') + ' <b data-o style="font-family:Lilita One;font-size:30px;display:block;color:#6FD3F2">0</b></span></div>' +
    '<button type="button" data-tap style="min-height:120px;width:min(320px,100%);border-radius:24px;border:0;background:#F5B82E;color:#15122B;font-family:Lilita One,system-ui;font-size:28px;box-shadow:0 8px 0 #B9861A">TAP TO SCORE</button></div>';
  var t = m.querySelector('[data-t]'), s = m.querySelector('[data-s]'), op = m.querySelector('[data-o]'), btn = m.querySelector('[data-tap]');
  btn.addEventListener('click', function () { if (!done && now() >= start) score += 120; });
  var iv = setInterval(function () {
    var n = now();
    if (n < start) { t.textContent = 'Starts in ' + Math.ceil((start - n) / 1000); return; }
    var leftMs = start + roundMs - n;
    if (leftMs <= 0) { if (!done) { done = true; clearInterval(iv); t.textContent = 'Time!'; o.onFinal && o.onFinal(score); } return; }
    if (!o.noAuto) score += 7;
    t.textContent = '0:' + String(Math.ceil(leftMs / 1000)).padStart(2, '0');
    s.textContent = score.toLocaleString('en-IN');
    var ol = o.getOpponentLive && o.getOpponentLive(); if (ol != null) op.textContent = Number(ol).toLocaleString('en-IN');
    if (n - lastLive > 250) { lastLive = n; o.onLive && o.onLive(score); }
  }, 100);
  return { stop: function () { done = true; clearInterval(iv); m.innerHTML = ''; } };
} };`;

const page = readFileSync(join(here, 'page.html'), 'utf8');
const MARK = '/*@CUP_PLAY@*/';
if (!page.includes(MARK)) throw new Error(`page.html has no ${MARK}`);
const hasPlay = existsSync(playPath);
// A script body can't hold "</script": split it so the HTML parser never sees one.
const play = (hasPlay ? readFileSync(playPath, 'utf8') : STUB).replace(/<\/(script)/gi, '<\\/$1');
const html = page.replace(MARK, () => play);
const bytes = Buffer.byteLength(html);
if (bytes > LIMIT) throw new Error(`diwali-cup.html is ${(bytes / 1024).toFixed(1)} KB, over the 250 KB limit`);
writeFileSync(out, html);
console.log(`${out}: ${(bytes / 1024).toFixed(1)} KB, play.js ${hasPlay ? `from ${playPath}` : 'STUB (cup/play.js not found)'}`);
