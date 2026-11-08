#pragma once
#include <Arduino.h>

const char DASHBOARD_HTML[] PROGMEM = R"rawliteral(<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32 Radio</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--text:#16181d;--muted:#6b7280;--accent:#2563eb;--line:#e5e7eb;--on:#dbeafe}
@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b22;--text:#e8eaf0;--muted:#8b93a3;--accent:#60a5fa;--line:#2a2f3a;--on:#1e3a5f}}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--text)}
main{max-width:560px;margin:0 auto;padding:16px}
h1{font-size:18px;margin:6px 0 14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
.state{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);font-weight:600}
.now{font-size:20px;font-weight:600;margin:4px 0 10px;word-break:break-word}
.muted{color:var(--muted);font-size:13px}
.row{display:flex;gap:8px;align-items:center}
.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin:8px 0}
.bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .4s}
button{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;cursor:pointer}
button:active{transform:scale(.98)}
.ctl button{flex:1}
input[type=range]{flex:1;accent-color:var(--accent)}
input[type=text]{flex:1;font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px;min-width:0}
.st{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;margin-bottom:6px}
.st small{color:var(--muted);white-space:nowrap}
.st.on{background:var(--on);border-color:var(--accent)}
#offline{background:#fee2e2;color:#991b1b;border-radius:10px;padding:8px 12px;margin-bottom:12px;font-size:13px}
</style></head><body><main>
<h1>ESP32 Malayalam Radio</h1>
<div id="offline" hidden>Radio not responding (it may be switching station or updating the list)...</div>

<div class="card">
  <div class="state" id="state">...</div>
  <div class="now" id="station">-</div>
  <div class="row muted"><span>Buffer</span><span id="bufv">0%</span></div>
  <div class="bar"><i id="buf"></i></div>
  <div class="muted" id="meta"></div>
</div>

<div class="card">
  <div class="row ctl">
    <button id="prev">&#9664; Prev</button>
    <button id="next">Next &#9654;</button>
  </div>
  <div class="row" style="margin-top:14px">
    <span class="muted">Vol</span>
    <input type="range" id="vol" min="0" max="100" value="15">
    <span id="volv" style="width:40px;text-align:right">15%</span>
  </div>
</div>

<div class="card">
  <div class="row" style="justify-content:space-between;margin-bottom:10px">
    <strong>Stations</strong>
    <button id="refresh">Refresh list</button>
  </div>
  <div id="list"></div>
</div>

<div class="card">
  <strong>Play a stream URL</strong>
  <div class="row" style="margin-top:10px">
    <input type="text" id="url" placeholder="http://... or https://... (MP3)">
    <button id="play">Play</button>
  </div>
</div>
</main>
<script>
const $=id=>document.getElementById(id);
let dragging=false,lastCount=-1;

async function api(path,data){
  const o=data?{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)}:{};
  const r=await fetch(path,o);
  return r.json();
}
function fmt(s){return Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m';}
function mark(idx){
  document.querySelectorAll('.st').forEach(b=>b.classList.toggle('on',+b.dataset.i===idx));
}
async function loadStations(idx){
  const l=await api('/api/stations');
  const box=$('list');
  box.textContent='';
  l.forEach(st=>{
    const b=document.createElement('button');
    b.className='st';
    b.dataset.i=st.i;
    const n=document.createElement('span');
    n.textContent=st.name;
    const k=document.createElement('small');
    k.textContent=(st.kbps?st.kbps+' kbps':'')+(st.https?' https':'');
    b.append(n,k);
    b.onclick=()=>act('/api/station',{i:st.i});
    box.append(b);
  });
  mark(idx);
}
async function refreshStatus(){
  try{
    const s=await api('/api/status');
    $('state').textContent=s.state;
    $('station').textContent=s.station||'-';
    if(!dragging){$('vol').value=s.volume;$('volv').textContent=s.volume+'%';}
    $('buf').style.width=s.buffer+'%';
    $('bufv').textContent=s.buffer+'%';
    $('meta').textContent='Wi-Fi '+s.rssi+' dBm | underruns '+s.underruns+' | free heap '+Math.round(s.heap/1024)+' KB | up '+fmt(s.uptime);
    if(s.count!==lastCount){lastCount=s.count;await loadStations(s.index);}
    mark(s.index);
    $('offline').hidden=true;
  }catch(e){$('offline').hidden=false;}
}
async function act(path,data){
  try{await api(path,data);}catch(e){}
  setTimeout(refreshStatus,800);
}
$('prev').onclick=()=>act('/api/prev',{});
$('next').onclick=()=>act('/api/next',{});
$('refresh').onclick=()=>{$('state').textContent='Updating list...';act('/api/refresh',{});};
$('play').onclick=()=>{const u=$('url').value.trim();if(u)act('/api/play',{url:u});};
$('vol').oninput=e=>{dragging=true;$('volv').textContent=e.target.value+'%';};
$('vol').onchange=async e=>{await act('/api/volume',{v:e.target.value});dragging=false;};
refreshStatus();
setInterval(refreshStatus,2000);
</script></body></html>)rawliteral";