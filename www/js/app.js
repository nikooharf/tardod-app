(function(){
"use strict";

/* ---------------- Storage ---------------- */
var STORE_KEY = "tarad_data_v2";
var DEFAULT_DATA = {
  settings: { employeeName: "", stdHours: 8, workDays: [6,0,1,2,3],
    mizito: { token: "", project: "", board: "", assignee: "", username: "", passHash: "" } },
  entries: {}
};
function loadData(){
  try{
    var raw = localStorage.getItem(STORE_KEY);
    if(!raw) return JSON.parse(JSON.stringify(DEFAULT_DATA));
    var d = JSON.parse(raw);
    if(!d.settings) d.settings = JSON.parse(JSON.stringify(DEFAULT_DATA.settings));
    if(!d.entries) d.entries = {};
    if(typeof d.settings.stdHours !== "number") d.settings.stdHours = 8;
    if(!Array.isArray(d.settings.workDays)) d.settings.workDays = [6,0,1,2,3];
    if(!d.settings.mizito) d.settings.mizito = { token:"", project:"", board:"", assignee:"" };
    ["token","project","board","assignee","username","passHash"].forEach(function(k){
      if(typeof d.settings.mizito[k] !== "string") d.settings.mizito[k] = "";
    });
    return d;
  }catch(e){ return JSON.parse(JSON.stringify(DEFAULT_DATA)); }
}
function saveData(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(DATA)); }catch(e){ showToast("ذخیره‌سازی ناموفق بود"); }
}
var DATA = loadData();

/* ---------------- Date / Jalali helpers ---------------- */
function pad2(n){ n = Math.floor(n); return (n<10? "0":"")+n; }
function makeLocalNoon(y,m,d){ return new Date(y, m-1, d, 12,0,0,0); }
function dateKeyOf(date){ return date.getFullYear()+"-"+pad2(date.getMonth()+1)+"-"+pad2(date.getDate()); }
function keyToDate(key){ var p = key.split('-').map(Number); return makeLocalNoon(p[0], p[1], p[2]); }
function todayKey(){ return dateKeyOf(new Date()); }

var jalaliNumFmt = new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'2-digit',day:'2-digit'});
var jalaliMonthFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian',{month:'long'});
var weekdayFmt = new Intl.DateTimeFormat('fa-IR',{weekday:'long'});
var weekdayShortFmt = new Intl.DateTimeFormat('fa-IR',{weekday:'short'});

function jalaliPartsOf(date){
  var parts = jalaliNumFmt.formatToParts(date);
  var o = {};
  parts.forEach(function(p){ if(p.type==='year'||p.type==='month'||p.type==='day') o[p.type]=parseInt(p.value,10); });
  return { y:o.year, m:o.month, d:o.day };
}
function jalaliLabel(date){
  var p = jalaliPartsOf(date);
  return p.y+"/"+pad2(p.m)+"/"+pad2(p.d);
}
function jalaliCompact(date){
  var p = jalaliPartsOf(date);
  return ""+p.y+pad2(p.m)+pad2(p.d);
}

var JALALI_MONTH_LEN = [31,31,31,31,31,31,30,30,30,30,30,29];
function cumDaysBeforeJalaliMonth(jm){
  var sum = 0;
  for(var i=0;i<jm-1;i++) sum += JALALI_MONTH_LEN[i];
  return sum;
}
var monthCache = {};
function firstGregorianOfJalaliMonth(jy, jm){
  var key = jy+"-"+jm;
  if(monthCache[key]) return monthCache[key];
  var base = makeLocalNoon(jy+621, 3, 15);
  base.setDate(base.getDate() + cumDaysBeforeJalaliMonth(jm));
  var found = null;
  for(var i=-15;i<=15;i++){
    var d = new Date(base.getTime());
    d.setDate(d.getDate()+i);
    var p = jalaliPartsOf(d);
    if(p.y===jy && p.m===jm && p.d===1){ found = d; break; }
  }
  monthCache[key] = found;
  return found;
}
function jalaliMonthInfo(jy, jm){
  var start = firstGregorianOfJalaliMonth(jy, jm);
  var nJm = jm===12?1:jm+1, nJy = jm===12?jy+1:jy;
  var nextStart = firstGregorianOfJalaliMonth(nJy, nJm);
  var days = Math.round((nextStart.getTime()-start.getTime())/86400000);
  return { start:start, days:days, name: jalaliMonthFmt.format(start) };
}
function minutesBetween(hIn,hOut){
  if(!hIn||!hOut) return null;
  var pi = hIn.split(":").map(Number), po = hOut.split(":").map(Number);
  var m1 = pi[0]*60+pi[1], m2 = po[0]*60+po[1];
  var diff = m2-m1;
  if(diff<0) diff += 24*60;
  return diff;
}
function fmtHours(min){
  min = Math.round(min||0);
  var h = Math.floor(Math.abs(min)/60), m = Math.abs(min)%60;
  return (min<0?'-':'')+h+(m? ':'+pad2(m):'');
}
function fmtMinutesShort(min){
  if(min==null) return "—";
  var sign = min<0 ? "-" : "";
  min = Math.abs(Math.round(min));
  var h = Math.floor(min/60), m = min%60;
  return sign+h+":"+pad2(m);
}

/* ---------------- Entry helpers ---------------- */
function getEntry(key){ return DATA.entries[key] || null; }
function setEntry(key, entry){ DATA.entries[key] = entry; saveData(); }
function removeEntry(key){ delete DATA.entries[key]; saveData(); }
function isWeeklyWorkDay(date){ return DATA.settings.workDays.indexOf(date.getDay()) !== -1; }
// A day counts toward the standard schedule only if it's a normal weekly work day
// AND it hasn't been explicitly marked as an official holiday.
function isEffectiveWorkDay(date){
  var entry = getEntry(dateKeyOf(date));
  if(entry && entry.type === 'holiday') return false;
  return isWeeklyWorkDay(date);
}

function entryWorkedMinutes(entry){
  if(!entry) return 0;
  if(entry.type==='normal' || entry.type==='remote'){
    var mins = minutesBetween(entry.checkIn, entry.checkOut);
    return mins==null? 0 : mins;
  }
  if(entry.type==='leave_hours'){
    var std = DATA.settings.stdHours*60;
    var lv = (entry.leaveMinutes||0);
    return Math.max(0, std - lv);
  }
  return 0;
}

function typeBadgeLabel(entry, date){
  if(!entry){
    return isWeeklyWorkDay(date) ? {cls:'missing', text:'ثبت نشده'} : {cls:'missing', text:'تعطیل هفتگی'};
  }
  if(entry.type==='normal') return {cls:'normal', text:'حضوری'};
  if(entry.type==='remote') return {cls:'remote', text:'دورکاری'};
  if(entry.type==='leave_full') return {cls:'leave', text:'مرخصی ('+(entry.leaveType||'استحقاقی')+')'};
  if(entry.type==='leave_hours') return {cls:'leave', text:'مرخصی ساعتی ('+((entry.leaveMinutes||0)/60)+' س)'};
  if(entry.type==='holiday') return {cls:'holiday', text: entry.holidayTitle ? 'تعطیل رسمی — '+entry.holidayTitle : 'تعطیل رسمی'};
  return {cls:'missing', text:'—'};
}

/* ---------------- Aggregation (used by Today's monthly stats, and later Calendar/Report) ---------------- */
function aggregateMonth(jy, jm){
  var info = jalaliMonthInfo(jy, jm);
  var workedMinutes = 0, leaveDays = 0, leaveHoursTotal=0, missingDays = 0, standardMinutes = 0, workDayCount=0, holidayDays=0;
  var leaveByType = {};
  var today0 = new Date(); today0.setHours(0,0,0,0);
  for(var d=1; d<=info.days; d++){
    var date = new Date(info.start.getTime());
    date.setDate(date.getDate()+(d-1));
    var key = dateKeyOf(date);
    var entry = getEntry(key);
    var effWd = isEffectiveWorkDay(date);
    if(effWd){ workDayCount++; standardMinutes += DATA.settings.stdHours*60; }
    if(entry){
      if(entry.type==='normal'||entry.type==='remote'){
        workedMinutes += entryWorkedMinutes(entry);
      } else if(entry.type==='leave_full'){
        leaveDays++;
        leaveByType[entry.leaveType||'استحقاقی'] = (leaveByType[entry.leaveType||'استحقاقی']||0)+1;
        workedMinutes += DATA.settings.stdHours*60;
      } else if(entry.type==='leave_hours'){
        leaveHoursTotal += (entry.leaveMinutes||0);
        workedMinutes += entryWorkedMinutes(entry);
      } else if(entry.type==='holiday'){
        holidayDays++;
      }
    } else if(effWd && date <= today0){
      missingDays++;
    }
  }
  var overtimeMinutes = workedMinutes - standardMinutes;
  return {
    days: info.days, start: info.start, workDayCount: workDayCount,
    workedMinutes: workedMinutes, standardMinutes: standardMinutes,
    overtimeMinutes: overtimeMinutes, leaveDays: leaveDays,
    leaveHoursTotal: leaveHoursTotal, leaveByType: leaveByType,
    missingDays: missingDays, holidayDays: holidayDays
  };
}

/* ---------------- Toast ---------------- */
var toastEl = document.getElementById('toast');
var toastTimer = null;
function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2200);
}

/* ---------------- Tabs ---------------- */
var views = ['today','calendar','report','settings'];
function switchView(name){
  views.forEach(function(v){
    document.getElementById('view-'+v).classList.toggle('active', v===name);
  });
  document.querySelectorAll('.tab').forEach(function(t){
    t.classList.toggle('active', t.getAttribute('data-view')===name);
  });
  if(name==='today') renderToday();
  if(name==='calendar') renderCalendar();
  if(name==='report') renderReport();
  if(name==='settings') renderSettings();
}
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click', function(){ switchView(t.getAttribute('data-view')); });
});

/* ---------------- Top date ---------------- */
function renderTopDate(){
  var now = new Date();
  var p = jalaliPartsOf(now);
  document.getElementById('topDate').textContent = weekdayFmt.format(now)+'، '+p.d+' '+jalaliMonthFmt.format(now)+' '+p.y;
}

/* ---------------- TODAY view ---------------- */
var clockTimer = null;
function mstat(n,l){ return '<div class="mstat"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>'; }

function renderToday(){
  var key = todayKey();
  var entry = getEntry(key);
  var statusLabel = document.getElementById('todayStatusLabel');
  var sub = document.getElementById('todaySub');
  var liveClock = document.getElementById('liveClock');
  var btn = document.getElementById('mainStampBtn');
  var btnLabel = document.getElementById('mainStampLabel');

  clearInterval(clockTimer);

  if(entry && entry.type==='holiday'){
    statusLabel.textContent = 'امروز تعطیل رسمی است';
    liveClock.textContent = entry.holidayTitle || 'تعطیل رسمی';
    sub.textContent = entry.note ? entry.note : 'برای تغییر، ویرایش دستی را بزنید';
    btn.style.display = 'none';
  } else if(entry && entry.type==='leave_full'){
    statusLabel.textContent = 'امروز مرخصی ثبت شده';
    liveClock.textContent = entry.leaveType || 'مرخصی';
    sub.textContent = entry.note ? entry.note : 'برای تغییر، ویرایش دستی را بزنید';
    btn.style.display = 'none';
  } else if(entry && (entry.type==='normal'||entry.type==='remote') && entry.checkIn && !entry.checkOut){
    statusLabel.textContent = (entry.type==='remote'?'دورکاری — ':'')+'در حال کار از ساعت '+entry.checkIn;
    btn.style.display = 'flex';
    btn.className = 'stamp-btn out';
    btnLabel.textContent = 'ثبت خروج';
    btn.disabled = false;
    (function(){
      function tick(){
        var mins = minutesBetween(entry.checkIn, new Date().toTimeString().slice(0,5));
        liveClock.textContent = fmtMinutesShort(mins);
        sub.textContent = 'مدت حضور تا این لحظه';
      }
      tick();
      clockTimer = setInterval(tick, 15000);
    })();
  } else if(entry && (entry.type==='normal'||entry.type==='remote') && entry.checkIn && entry.checkOut){
    var mins = minutesBetween(entry.checkIn, entry.checkOut);
    statusLabel.textContent = (entry.type==='remote'?'دورکاری امروز ثبت شد':'حضور امروز ثبت شد');
    liveClock.textContent = fmtMinutesShort(mins);
    sub.textContent = entry.checkIn+' تا '+entry.checkOut;
    btn.style.display = 'none';
  } else {
    statusLabel.textContent = 'هنوز ورود ثبت نشده';
    liveClock.textContent = new Date().toTimeString().slice(0,5);
    clockTimer = setInterval(function(){ liveClock.textContent = new Date().toTimeString().slice(0,5); }, 1000*20);
    sub.textContent = 'برای شروع، ورود را ثبت کنید';
    btn.style.display = 'flex';
    btn.className = 'stamp-btn in';
    btnLabel.textContent = 'ثبت ورود';
    btn.disabled = false;
  }

  var now = new Date();
  var jp = jalaliPartsOf(now);
  var agg = aggregateMonth(jp.y, jp.m);
  document.getElementById('todayMonthStats').innerHTML =
    mstat(fmtHours(agg.workedMinutes), 'کارکرد این ماه') +
    mstat(fmtHours(agg.overtimeMinutes>0?agg.overtimeMinutes:0), 'اضافه‌کاری') +
    mstat(agg.leaveDays, 'روز مرخصی') +
    mstat(agg.holidayDays, 'تعطیل رسمی');
  var remaining = agg.standardMinutes - agg.workedMinutes;
  document.getElementById('todayRemainingLabel').textContent = remaining>0 ? fmtHours(remaining)+' مانده' : fmtHours(-remaining)+' اضافه';
}

document.getElementById('mainStampBtn').addEventListener('click', function(){
  var key = todayKey();
  var entry = getEntry(key);
  var now = new Date().toTimeString().slice(0,5);
  if(!entry || !entry.checkIn){
    entry = entry || {};
    entry.type = entry.type || 'normal';
    entry.checkIn = now;
    entry.checkOut = null;
    setEntry(key, entry);
    showToast('ورود ثبت شد: '+now);
  } else if(!entry.checkOut){
    entry.checkOut = now;
    setEntry(key, entry);
    showToast('خروج ثبت شد: '+now);
  }
  renderToday();
});

document.getElementById('btnRemoteToggle').addEventListener('click', function(){
  var key = todayKey();
  var entry = getEntry(key) || { type:'normal', checkIn:null, checkOut:null };
  if(entry.type==='leave_full' || entry.type==='leave_hours' || entry.type==='holiday'){
    showToast('امروز حالت دیگری ثبت شده — ابتدا آن را ویرایش کنید'); return;
  }
  entry.type = (entry.type==='remote') ? 'normal' : 'remote';
  setEntry(key, entry);
  showToast(entry.type==='remote' ? 'امروز به‌عنوان دورکاری ثبت شد' : 'امروز به‌عنوان حضوری ثبت شد');
  renderToday();
});

document.getElementById('btnLeaveToday').addEventListener('click', function(){ openSheet(todayKey()); });
document.getElementById('btnEditToday').addEventListener('click', function(){ openSheet(todayKey()); });

/* ---------------- CALENDAR view ---------------- */
var calView = jalaliPartsOf(new Date());
function renderCalendar(){
  var info = jalaliMonthInfo(calView.y, calView.m);
  document.getElementById('calMonthTitle').textContent = info.name+' '+calView.y;
  var agg = aggregateMonth(calView.y, calView.m);
  document.getElementById('calMonthStats').innerHTML =
    mstat(fmtHours(agg.workedMinutes),'کارکرد') +
    mstat(agg.leaveDays,'مرخصی') +
    mstat(agg.holidayDays,'تعطیل رسمی') +
    mstat(agg.missingDays,'بدون ثبت');

  var tKey = todayKey();
  var listEl = document.getElementById('calDayList');
  var html = '';
  for(var d=1; d<=info.days; d++){
    var date = new Date(info.start.getTime());
    date.setDate(date.getDate()+(d-1));
    var key = dateKeyOf(date);
    var entry = getEntry(key);
    var wd = isWeeklyWorkDay(date);
    var isHoliday = entry && entry.type==='holiday';
    var badge = typeBadgeLabel(entry, date);
    var detail = '';
    if(entry && (entry.type==='normal'||entry.type==='remote')){
      detail = (entry.checkIn||'—')+' – '+(entry.checkOut||'—');
    } else if(entry && entry.type==='leave_hours'){
      detail = ((entry.leaveMinutes||0)/60)+' ساعت مرخصی';
    } else if(entry && entry.type==='leave_full'){
      detail = entry.leaveType||'مرخصی';
    } else if(isHoliday){
      detail = entry.holidayTitle || 'تعطیل رسمی';
    } else {
      detail = wd ? 'بدون ثبت' : 'تعطیل هفتگی';
    }
    var rowCls = 'day-row';
    if(!wd && !isHoliday) rowCls += ' off';
    if(isHoliday) rowCls += ' holiday';
    if(key===tKey) rowCls += ' today';
    html += '<div class="'+rowCls+'" data-key="'+key+'">'+
      '<div class="day-num">'+d+'</div>'+
      '<div class="day-info"><div class="day-wd">'+weekdayShortFmt.format(date)+'</div><div class="day-detail">'+detail+'</div></div>'+
      '<span class="badge '+badge.cls+'">'+badge.text+'</span>'+
      '</div>';
  }
  listEl.innerHTML = html || '<div class="empty">داده‌ای برای این ماه نیست</div>';
  Array.prototype.forEach.call(listEl.querySelectorAll('.day-row'), function(row){
    row.addEventListener('click', function(){ openSheet(row.getAttribute('data-key')); });
  });
}
document.getElementById('calPrev').addEventListener('click', function(){
  calView.m--; if(calView.m<1){ calView.m=12; calView.y--; } renderCalendar();
});
document.getElementById('calNext').addEventListener('click', function(){
  calView.m++; if(calView.m>12){ calView.m=1; calView.y++; } renderCalendar();
});

/* ---------------- Mizito sync (phase 7, optional, needs internet only when used) ---------------- */
function parseMizitoCurl(text){
  if(!text || !text.trim()) return null;
  var tokenMatch = text.match(/-H\s+'x-token:\s*([^']+)'/i) || text.match(/-H\s+"x-token:\s*([^"]+)"/i);
  var dataMatch = text.match(/--data-raw\s+'([\s\S]*)'\s*$/) || text.match(/--data-raw\s+"([\s\S]*)"\s*$/) || text.match(/-d\s+'([\s\S]*)'\s*$/);
  if(!dataMatch) return null;
  var body;
  try{ body = JSON.parse(dataMatch[1]); }catch(e){ return null; }
  if(!body || !body.project || !body.kanban_board || !body.assignee || !body.assignee[0]) return null;
  var out = { project: body.project, board: body.kanban_board, assignee: body.assignee[0] };
  if(tokenMatch) out.token = tokenMatch[1].trim();   // optional now: the app can log in by itself
  return out;
}
// Accepts the cURL of  /capi/session/create  (or just its JSON payload) -> {username, passHash}
function parseMizitoLogin(text){
  if(!text || !text.trim()) return null;
  var user = null, pass = null;
  var a = text.indexOf('{'), b = text.lastIndexOf('}');
  if(a !== -1 && b > a){
    try{ var o = JSON.parse(text.slice(a, b+1)); user = o.username; pass = o.password; }catch(e){}
  }
  if(!user || !pass){
    var um = text.match(/"username"\s*:\s*"([^"]+)"/), pm = text.match(/"password"\s*:\s*"([^"]+)"/);
    if(um) user = um[1]; if(pm) pass = pm[1];
  }
  if(!user || !pass) return null;
  return { username: String(user).trim(), passHash: String(pass).trim() };
}
function mzHasLogin(){
  var m = DATA.settings.mizito;
  return !!(m && m.username && m.passHash);
}
function mizitoConfigured(){
  var m = DATA.settings.mizito;
  return !!(m && m.project && m.board && m.assignee && (m.token || mzHasLogin()));
}
function buildMizitoNotes(entry){
  if(!entry) return "";
  var lines = [];
  if(entry.type==='normal' || entry.type==='remote'){
    if(entry.type==='remote') lines.push('دورکاری');
    lines.push('ساعت ورود: '+(entry.checkIn||'—'));
    lines.push('ساعت خروج: '+(entry.checkOut||'—'));
  } else if(entry.type==='leave_full'){
    lines.push('مرخصی روزانه ('+(entry.leaveType||'استحقاقی')+')');
  } else if(entry.type==='leave_hours'){
    lines.push('مرخصی ساعتی: '+((entry.leaveMinutes||0)/60)+' ساعت');
  } else if(entry.type==='holiday'){
    lines.push('تعطیل رسمی'+(entry.holidayTitle? (': '+entry.holidayTitle):''));
  }
  if(entry.note) lines.push(entry.note);
  return lines.join('\n');
}
/* ---- Mizito helpers: smart sync (add / update / skip) ---- */
function mzNormDigits(s){
  return String(s == null ? '' : s)
    .replace(/[\u06F0-\u06F9]/g, function(c){ return String(c.charCodeAt(0) - 0x06F0); })
    .replace(/[\u0660-\u0669]/g, function(c){ return String(c.charCodeAt(0) - 0x0660); });
}
// "14050629" / "1405/06/29" / "۱۴۰۵۰۶۲۹"  ->  "14050629"
function mzTitleKey(s){ return mzNormDigits(s).replace(/\D/g, ''); }
function mzNormNotes(s){
  return mzNormDigits(s).replace(/\r\n?/g, '\n').split('\n').map(function(l){ return l.trim(); }).join('\n').trim();
}
function mzHeaders(token){
  var h = {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'origin': 'https://office.mizito.ir',
    'referer': 'https://office.mizito.ir/'
  };
  if(token) h['x-token'] = token;
  return h;
}
/* Automatic login: username + the (already hashed) password copied from the browser -> fresh x-token.
   Single-flight so a bulk run never logs in twice at once. */
var mzLoginPromise = null;
function mzLogin(){
  if(mzLoginPromise) return mzLoginPromise;
  var m = DATA.settings.mizito;
  if(!mzHasLogin()){ var ne = new Error('نام کاربری/رمز میزیتو ثبت نشده'); ne.login = true; return Promise.reject(ne); }
  mzLoginPromise = fetch('https://app.mizito.ir/capi/session/create', {
    method: 'POST', headers: mzHeaders(null),
    body: JSON.stringify({ username: m.username, password: m.passHash, loginCode: null, regId: null })
  }).then(function(res){
    if(!res.ok){ var e = new Error('HTTP ' + res.status); e.httpStatus = res.status; throw e; }
    return res.json();
  }).then(function(j){
    if(j && j.status === 1 && j.token){
      DATA.settings.mizito.token = j.token;
      saveData();
      return j.token;
    }
    throw new Error((j && (j.msg || j.message)) ? (j.msg || j.message) : 'پاسخ نامعتبر از میزیتو');
  }).then(function(t){ mzLoginPromise = null; return t; },
          function(err){ mzLoginPromise = null; err.login = true; throw err; });
  return mzLoginPromise;
}
function mzRaw(path, body, token){
  return fetch('https://app.mizito.ir/api/' + path, {
    method: 'POST', headers: mzHeaders(token), body: JSON.stringify(body)
  }).then(function(res){
    if(!res.ok){ var e = new Error('HTTP ' + res.status); e.httpStatus = res.status; throw e; }
    return res.json();
  }).then(function(j){
    // some APIs answer 200 with {status:0,msg:..} when the token is bad
    if(j && !Array.isArray(j) && typeof j.status === 'number' && j.status !== 1 && !j._id){
      var e = new Error(j.msg || j.message || 'رد شد'); e.httpStatus = 401; e.soft = true; throw e;
    }
    return j;
  });
}
/* POST with automatic token handling:
   - no token yet  -> log in first
   - server rejects the token (4xx) -> log in again, retry ONCE */
function mzPost(path, body){
  var m = DATA.settings.mizito;
  var start = m.token ? Promise.resolve(m.token) : mzLogin();
  return start.then(function(tok){
    return mzRaw(path, body, tok).catch(function(err){
      var retryable = err && err.httpStatus >= 400 && err.httpStatus < 500 && mzHasLogin();
      if(!retryable) throw err;
      return mzLogin().then(function(t2){ return mzRaw(path, body, t2); });
    });
  });
}
function mzErrMessage(err){
  if(err && err.login){
    return 'ورود خودکار به میزیتو ناموفق بود — نام کاربری و رمز (هش‌شده) را دوباره در تنظیمات ثبت کنید' +
           (err.message ? ' (' + err.message + ')' : '');
  }
  if(err && err.httpStatus){
    if(err.httpStatus === 401 || err.httpStatus === 403)
      return mzHasLogin() ? 'دسترسی رد شد (' + err.httpStatus + ')' + (err.soft && err.message ? ' — ' + err.message : '')
                          : 'توکن میزیتو منقضی شده — نام کاربری و رمز را در تنظیمات ثبت کنید یا دوباره cURL را جای‌گذاری کنید';
    return 'خطای سرور میزیتو (' + err.httpStatus + ')';
  }
  return 'اتصال برقرار نشد — اینترنت را چک کنید' + (err && err.message ? ' (' + err.message + ')' : '');
}
// Fetch my own tasks only (same project + same board + same assignee), non-deleted.
function fetchMizitoTasks(){
  var m = DATA.settings.mizito;
  return mzPost('tasks/upcoming', { project_id: m.project, kanban: true, from: null, filter: null })
    .then(function(j){
      var arr = Array.isArray(j) ? j : (j && (j.tasks || j.data || j.result || j.items));
      if(!Array.isArray(arr)) throw new Error('پاسخ نامعتبر از میزیتو (لیست وظایف)');
      return arr.filter(function(t){
        return t && !t.deleted &&
          t.kanban_board === m.board &&
          Array.isArray(t.assignee) && t.assignee.indexOf(m.assignee) !== -1;
      });
    });
}
function findMizitoTask(tasks, title){
  var k = mzTitleKey(title), found = null;
  for(var i = 0; i < tasks.length; i++){
    if(mzTitleKey(tasks[i].title) === k){
      // if duplicates already exist, work on the oldest one
      if(!found || String(tasks[i].created_at) < String(found.created_at)) found = tasks[i];
    }
  }
  return found;
}
/* Sync one day. `tasks` is an optional pre-fetched list (used by the monthly bulk send).
   Returns {ok, action:'added'|'updated'|'unchanged', message?} */
function syncEntryToMizito(key, tasks){
  var m = DATA.settings.mizito;
  var entry = getEntry(key);
  if(!mizitoConfigured() || !entry) return Promise.resolve({ok:false, message:'تنظیمات میزیتو کامل نیست'});
  var title = jalaliCompact(keyToDate(key));
  var notes = buildMizitoNotes(entry);

  var listP = tasks ? Promise.resolve(tasks) : fetchMizitoTasks();
  return listP.then(function(list){
    var existing = findMizitoTask(list, title);

    function markSent(task){
      entry.mizitoSentAt = Date.now();
      if(task && task._id) entry.mizitoTaskId = task._id;
      setEntry(key, entry);
    }

    if(existing){
      if(mzNormNotes(existing.notes) === mzNormNotes(notes)){
        markSent(existing);
        return { ok:true, action:'unchanged' };
      }
      // the day already exists but with different text -> edit it, never create a second one
      var payload = {
        task_id: existing._id,
        token: existing.access_token,
        title: existing.title,
        notes: notes,
        assignee: existing.assignee && existing.assignee.length ? existing.assignee : [m.assignee],
        project: m.project,
        kanban_board: existing.kanban_board || m.board,
        labels: existing.labels || [],
        attachments: existing.attachments || [],
        checklist: existing.checklist || [],
        deleted: false,
        alarm_options: existing.alarm_options || null,
        progress: existing.progress || 0,
        responsible: existing.responsible || null,
        comment: "",
        insert_to_chat_group: true
      };
      return mzPost('tasks/save', payload).then(function(j){
        if(j && j._id){
          existing.notes = notes;                 // keep the cache fresh for the bulk run
          if(j.access_token) existing.access_token = j.access_token;
          markSent(j);
          return { ok:true, action:'updated' };
        }
        return { ok:false, message:(j && j.msg) ? j.msg : 'ویرایش در میزیتو ناموفق بود (برای جلوگیری از تکراری شدن، چیزی اضافه نشد)' };
      });
    }

    // not on the board yet -> create
    var addPayload = {
      title: title, notes: notes, assignee: [m.assignee],
      project: m.project, kanban_board: m.board,
      labels: [], attachments: [], deleted: false, alarm_options: null,
      progress: 0, weight: 1, comment: "", responsible: null, insert_to_chat_group: true
    };
    return mzPost('tasks/add', addPayload).then(function(j){
      if(j && j._id){
        list.push(j);                              // a repeat inside the same run can't duplicate
        markSent(j);
        return { ok:true, action:'added' };
      }
      return { ok:false, message:(j && j.msg) ? j.msg : 'پاسخ نامعتبر از میزیتو' };
    });
  }).catch(function(err){
    return { ok:false, message: mzErrMessage(err) };
  });
}
function sendEntryToMizito(key){ return syncEntryToMizito(key, null); }
function sendMonthToMizito(jy, jm, onProgress){
  var info = jalaliMonthInfo(jy, jm);
  var keys = [];
  for(var d = 1; d <= info.days; d++){
    var date = new Date(info.start.getTime());
    date.setDate(date.getDate() + (d - 1));
    var key = dateKeyOf(date);
    if(getEntry(key)) keys.push(key);
  }
  var res = { added:0, updated:0, unchanged:0, failed:0, total:keys.length, firstError:'' };
  if(!keys.length) return Promise.resolve(res);
  return fetchMizitoTasks().then(function(list){
    var i = 0;
    function next(){
      if(i >= keys.length) return Promise.resolve(res);
      var key = keys[i++];
      return syncEntryToMizito(key, list).then(function(r){
        if(r.ok) res[r.action]++; else { res.failed++; if(!res.firstError) res.firstError = r.message || ''; }
        if(onProgress) onProgress(i, keys.length);
        return next();
      });
    }
    return next();
  }).catch(function(err){
    res.failed = keys.length; res.firstError = mzErrMessage(err);
    return res;
  });
}

/* ---------------- Entry edit sheet (shared: today + any date) ---------------- */
var sheetKey = null;
var sheetType = 'normal';
function openSheet(key, forceType){
  sheetKey = key;
  var date = keyToDate(key);
  var entry = getEntry(key);
  document.getElementById('sheetTitle').textContent = jalaliLabel(date)+' — '+weekdayFmt.format(date);
  sheetType = forceType || (entry ? entry.type : (isWeeklyWorkDay(date) ? 'normal' : 'off'));
  setSegType(sheetType);
  document.getElementById('fIn').value = (entry && entry.checkIn) || '';
  document.getElementById('fOut').value = (entry && entry.checkOut) || '';
  document.getElementById('fLeaveType').value = (entry && entry.leaveType) || 'استحقاقی';
  document.getElementById('fLeaveHours').value = entry && entry.leaveMinutes ? (entry.leaveMinutes/60) : 4;
  document.getElementById('fHolidayTitle').value = (entry && entry.holidayTitle) || '';
  document.getElementById('fNote').value = (entry && entry.note) || '';
  document.getElementById('btnDeleteEntry').style.display = entry ? 'block' : 'none';
  var mzRow = document.getElementById('mzSendRow');
  var mzNote = document.getElementById('mzSendNote');
  if(mizitoConfigured() && entry){
    mzRow.style.display = 'flex';
    mzNote.className = 'mz-note';
    mzNote.textContent = entry.mizitoSentAt ? ('قبلاً ارسال شده — '+new Date(entry.mizitoSentAt).toLocaleString('fa-IR')) : '';
  } else {
    mzRow.style.display = 'none';
    mzNote.textContent = '';
  }
  document.getElementById('sheetBackdrop').classList.add('open');
}
function closeSheet(){ document.getElementById('sheetBackdrop').classList.remove('open'); sheetKey = null; }
function setSegType(t){
  sheetType = t;
  Array.prototype.forEach.call(document.querySelectorAll('#segType button'), function(b){
    b.classList.toggle('on', b.getAttribute('data-v')===t);
  });
  document.getElementById('blockTimes').style.display = (t==='normal'||t==='remote') ? 'block' : 'none';
  document.getElementById('blockLeaveType').style.display = (t==='leave_full') ? 'block' : 'none';
  document.getElementById('blockLeaveHours').style.display = (t==='leave_hours') ? 'block' : 'none';
  document.getElementById('blockHolidayNote').style.display = (t==='holiday') ? 'block' : 'none';
}
Array.prototype.forEach.call(document.querySelectorAll('#segType button'), function(b){
  b.addEventListener('click', function(){ setSegType(b.getAttribute('data-v')); });
});
document.getElementById('sheetBackdrop').addEventListener('click', function(e){ if(e.target===this) closeSheet(); });
document.getElementById('btnCancelEntry').addEventListener('click', closeSheet);
document.getElementById('btnSendMizito').addEventListener('click', function(){
  if(!sheetKey) return;
  var btn = document.getElementById('btnSendMizito');
  var note = document.getElementById('mzSendNote');
  btn.disabled = true;
  note.className = 'mz-note';
  note.textContent = 'در حال ارسال...';
  sendEntryToMizito(sheetKey).then(function(r){
    btn.disabled = false;
    if(r.ok){
      note.className = 'mz-note ok';
      var msg = r.action === 'added' ? 'در میزیتو ثبت شد ✓'
              : r.action === 'updated' ? 'این روز در میزیتو بود؛ ویرایش شد ✓'
              : 'این روز با همین محتوا در میزیتو بود؛ تغییری لازم نبود ✓';
      note.textContent = msg;
      showToast(msg);
    } else {
      note.className = 'mz-note err';
      note.textContent = r.message || 'ارسال ناموفق بود';
    }
  });
});
document.getElementById('btnDeleteEntry').addEventListener('click', function(){
  if(!sheetKey) return;
  removeEntry(sheetKey);
  showToast('حذف شد');
  closeSheet();
  refreshAll();
});
document.getElementById('btnSaveEntry').addEventListener('click', function(){
  if(!sheetKey) return;
  if(sheetType==='off'){ removeEntry(sheetKey); showToast('ذخیره شد'); closeSheet(); refreshAll(); return; }
  var entry = { type: sheetType, note: document.getElementById('fNote').value.trim() };
  if(sheetType==='normal' || sheetType==='remote'){
    entry.checkIn = document.getElementById('fIn').value || null;
    entry.checkOut = document.getElementById('fOut').value || null;
  } else if(sheetType==='leave_full'){
    entry.leaveType = document.getElementById('fLeaveType').value;
  } else if(sheetType==='leave_hours'){
    var hrs = parseFloat(document.getElementById('fLeaveHours').value)||0;
    entry.leaveMinutes = Math.round(hrs*60);
  } else if(sheetType==='holiday'){
    entry.holidayTitle = document.getElementById('fHolidayTitle').value.trim();
  }
  setEntry(sheetKey, entry);
  showToast(sheetKey===todayKey() ? 'ذخیره شد' : 'برای '+jalaliLabel(keyToDate(sheetKey))+' ذخیره شد');
  closeSheet();
  refreshAll();
});

/* ---------------- Official-holiday-for-another-day quick action ---------------- */
document.getElementById('btnHolidayPick').addEventListener('click', function(){
  document.getElementById('fPickDate').value = todayKey();
  document.getElementById('datePickBackdrop').classList.add('open');
});
document.getElementById('datePickBackdrop').addEventListener('click', function(e){ if(e.target===this) this.classList.remove('open'); });
document.getElementById('btnCancelDatePick').addEventListener('click', function(){
  document.getElementById('datePickBackdrop').classList.remove('open');
});
document.getElementById('btnConfirmDatePick').addEventListener('click', function(){
  var v = document.getElementById('fPickDate').value; // "YYYY-MM-DD" gregorian, from native date input
  if(!v){ showToast('یک تاریخ انتخاب کنید'); return; }
  document.getElementById('datePickBackdrop').classList.remove('open');
  openSheet(v, 'holiday');
});

/* ---------------- Settings (name / standard hours — full settings in a later phase) ---------------- */
function renderSettings(){
  document.getElementById('setName').value = DATA.settings.employeeName || '';
  document.getElementById('setStdHours').value = DATA.settings.stdHours;
  renderWeekdayGrid();
  var m = DATA.settings.mizito;
  var box = document.getElementById('mzParsedBox');
  document.getElementById('mzUser').value = (m && m.username) || '';
  document.getElementById('mzPass').value = (m && m.passHash) || '';
  document.getElementById('mzLoginState').textContent = mzHasLogin() ? 'ورود خودکار فعال است ✓' : 'ورود خودکار تنظیم نشده';
  if(m && (m.project || m.board || m.assignee || m.token)){
    box.style.display = 'block';
    document.getElementById('mzProject').value = m.project || '';
    document.getElementById('mzBoard').value = m.board || '';
    document.getElementById('mzAssignee').value = m.assignee || '';
  } else {
    box.style.display = 'none';
  }
}
document.getElementById('setName').addEventListener('change', function(){
  DATA.settings.employeeName = this.value.trim(); saveData();
});
document.getElementById('setStdHours').addEventListener('change', function(){
  var v = parseFloat(this.value); if(!v || v<=0) v = 8;
  DATA.settings.stdHours = v; saveData(); refreshAll();
});

/* ---------------- REPORT view ---------------- */
var repView = jalaliPartsOf(new Date());
function rstat(n,l){ return '<div class="rstat"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>'; }
function renderReport(){
  var info = jalaliMonthInfo(repView.y, repView.m);
  document.getElementById('repMonthTitle').textContent = info.name+' '+repView.y;
  var agg = aggregateMonth(repView.y, repView.m);
  document.getElementById('repGrid').innerHTML =
    rstat(fmtHours(agg.workedMinutes),'جمع کارکرد') +
    rstat(fmtHours(agg.overtimeMinutes), (agg.overtimeMinutes>=0?'اضافه‌کاری':'کسری کارکرد')) +
    rstat(agg.leaveDays+' روز','مرخصی روزانه') +
    rstat(agg.holidayDays+' روز','تعطیل رسمی') +
    rstat(agg.missingDays+' روز','بدون ثبت');
  document.getElementById('btnMizitoBulk').style.display = mizitoConfigured() ? 'flex' : 'none';
}
document.getElementById('repPrev').addEventListener('click', function(){
  repView.m--; if(repView.m<1){ repView.m=12; repView.y--; } renderReport();
});
document.getElementById('repNext').addEventListener('click', function(){
  repView.m++; if(repView.m>12){ repView.m=1; repView.y++; } renderReport();
});
document.getElementById('btnMizitoBulk').addEventListener('click', function(){
  var btn = document.getElementById('btnMizitoBulk');
  var note = document.getElementById('mzBulkNote');
  btn.disabled = true;
  note.className = 'mz-note';
  note.textContent = 'در حال ارسال...';
  sendMonthToMizito(repView.y, repView.m, function(done, total){
    note.textContent = 'در حال ارسال... ('+done+' از '+total+')';
  }).then(function(r){
    btn.disabled = false;
    if(r.total === 0){
      note.className = 'mz-note';
      note.textContent = 'در این ماه روزی برای ارسال ثبت نشده است';
    } else if(r.failed === 0){
      note.className = 'mz-note ok';
      note.textContent = r.added + ' جدید، ' + r.updated + ' ویرایش‌شده، ' + r.unchanged + ' بدون تغییر ✓';
    } else {
      note.className = 'mz-note err';
      note.textContent = r.added + ' جدید، ' + r.updated + ' ویرایش، ' + r.unchanged + ' بدون تغییر، ' + r.failed + ' ناموفق' +
        (r.firstError ? ' — ' + r.firstError : '');
    }
    showToast('همگام‌سازی با میزیتو تمام شد');
  });
});

/* ---------------- Native save/share helper ----------------
   On a real device (inside the Capacitor shell) this writes the file to the
   app's private cache folder and opens the native share sheet (Telegram,
   email, Bluetooth, "Save to Files", etc.) — fully offline, no server involved.
   If there's no native bridge (e.g. testing index.html in a plain desktop
   browser during development), it falls back to a normal browser download
   so the project stays easy to preview while building. */
function getCapacitorPlugins(){
  return (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : null;
}
function nativeSaveAndShare(fname, data, isText){
  var plugins = getCapacitorPlugins();
  if(!plugins || !plugins.Filesystem){
    return Promise.resolve(false);
  }
  var Filesystem = plugins.Filesystem;
  var Share = plugins.Share;
  var opts = { path: fname, data: data, directory: 'CACHE' };
  if(isText) opts.encoding = 'utf8';
  return Filesystem.writeFile(opts).then(function(res){
    if(Share){
      return Share.share({ title: fname, url: res.uri, dialogTitle: 'ارسال / ذخیره فایل' }).then(function(){ return true; }).catch(function(){
        // user simply cancelled the share sheet — the file was still written successfully
        return true;
      });
    }
    showToast('فایل ذخیره شد');
    return true;
  }).catch(function(err){
    showToast('خطا در ذخیره فایل: '+(err && err.message ? err.message : 'نامشخص'));
    return true; // handled (with an error message) — don't also fall back to browser download
  });
}
function browserDownloadFallback(fname, blob){
  try{
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
    showToast('فایل دانلود شد');
  }catch(e){ showToast('خطا در دانلود فایل'); }
}

/* ---------------- Excel export ---------------- */
function buildReportWorkbook(jy, jm){
  var info = jalaliMonthInfo(jy, jm);
  var agg = aggregateMonth(jy, jm);
  var name = DATA.settings.employeeName || '—';
  var genDate = jalaliLabel(new Date());

  var HEAD_FILL = "1F2A37", HEAD_FONT = "FFFFFF";
  var TITLE_FILL = "AE3A2E";
  var rows = [];

  rows.push(["گزارش تردد پرسنل"]);
  rows.push(["نام: "+name, "", "ماه: "+info.name+" "+jy, "", "تاریخ تهیه: "+genDate]);
  rows.push([]);
  var headers = ["ردیف","تاریخ","روز هفته","وضعیت","ساعت ورود","ساعت خروج","مدت کارکرد (ساعت)","نسبت به سقف روزانه","توضیحات"];
  rows.push(headers);

  for(var d=1; d<=info.days; d++){
    var date = new Date(info.start.getTime());
    date.setDate(date.getDate()+(d-1));
    var key = dateKeyOf(date);
    var entry = getEntry(key);
    var wd = isWeeklyWorkDay(date);
    var statusText = "تعطیل هفتگی";
    var cin = "", cout = "", worked = "", diffText = "";
    var note = entry && entry.note ? entry.note : "";

    if(entry){
      if(entry.type==='normal'){ statusText = "حضوری"; }
      else if(entry.type==='remote'){ statusText = "دورکاری"; }
      else if(entry.type==='leave_full'){ statusText = "مرخصی ("+(entry.leaveType||"استحقاقی")+")"; }
      else if(entry.type==='leave_hours'){ statusText = "مرخصی ساعتی"; }
      else if(entry.type==='holiday'){ statusText = "تعطیل رسمی"+(entry.holidayTitle? (" — "+entry.holidayTitle):""); }

      if(entry.type==='normal'||entry.type==='remote'){
        cin = entry.checkIn||""; cout = entry.checkOut||"";
        var mins = minutesBetween(entry.checkIn, entry.checkOut);
        if(mins!=null){
          worked = (mins/60).toFixed(2);
          var diff = mins - DATA.settings.stdHours*60;
          diffText = (diff>=0?"+":"")+(diff/60).toFixed(2);
        }
      } else if(entry.type==='leave_hours'){
        worked = (entryWorkedMinutes(entry)/60).toFixed(2);
        diffText = (-(entry.leaveMinutes||0)/60).toFixed(2);
        note = (((entry.leaveMinutes||0)/60)+" ساعت مرخصی")+(note? " — "+note:"");
      } else if(entry.type==='leave_full'){
        worked = DATA.settings.stdHours.toFixed(2);
        diffText = "0.00";
      } else if(entry.type==='holiday'){
        diffText = "0.00";
      }
    } else if(wd){
      statusText = "بدون ثبت";
    }

    rows.push([d, jalaliLabel(date), weekdayFmt.format(date), statusText, cin, cout, worked, diffText, note]);
  }

  var sumRowStart = rows.length + 1;
  rows.push([]);
  rows.push(["جمع‌بندی ماه"]);
  rows.push(["جمع ساعت کارکرد", (agg.workedMinutes/60).toFixed(2)]);
  rows.push(["اضافه‌کاری / کسری (ساعت)", (agg.overtimeMinutes/60).toFixed(2)]);
  rows.push(["تعداد روز مرخصی روزانه", agg.leaveDays]);
  rows.push(["جمع ساعات مرخصی ساعتی", (agg.leaveHoursTotal/60).toFixed(2)]);
  rows.push(["تعداد روزهای تعطیل رسمی", agg.holidayDays]);
  rows.push(["تعداد روزهای بدون ثبت (کاری)", agg.missingDays]);
  Object.keys(agg.leaveByType).forEach(function(t){
    rows.push(["  از این میان، مرخصی "+t, agg.leaveByType[t]]);
  });

  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:5},{wch:12},{wch:10},{wch:24},{wch:10},{wch:10},{wch:14},{wch:16},{wch:26}];
  var lastCol = headers.length-1;

  ws['!merges'] = [
    {s:{r:0,c:0},e:{r:0,c:lastCol}},
    {s:{r:1,c:0},e:{r:1,c:1}},
    {s:{r:1,c:2},e:{r:1,c:3}},
    {s:{r:1,c:4},e:{r:1,c:lastCol}},
    {s:{r:sumRowStart,c:0},e:{r:sumRowStart,c:lastCol}}
  ];

  function styleCell(r,c,style){
    var addr = XLSX.utils.encode_cell({r:r,c:c});
    if(!ws[addr]) ws[addr] = {t:'s', v:''};
    ws[addr].s = style;
  }
  var thinBorder = { style:"thin", color:{rgb:"D9D5C9"} };
  var borderAll = { top:thinBorder, bottom:thinBorder, left:thinBorder, right:thinBorder };

  styleCell(0,0,{ font:{bold:true, sz:14, color:{rgb:HEAD_FONT}}, fill:{fgColor:{rgb:TITLE_FILL}}, alignment:{horizontal:"center", vertical:"center"} });
  for(var c=0;c<=lastCol;c++){ if(c>0) styleCell(0,c,{ fill:{fgColor:{rgb:TITLE_FILL}} }); }
  styleCell(1,0,{ font:{bold:true, sz:10.5}, alignment:{horizontal:"right"} });
  styleCell(1,2,{ font:{bold:true, sz:10.5}, alignment:{horizontal:"center"} });
  styleCell(1,4,{ font:{bold:true, sz:10.5}, alignment:{horizontal:"left"} });

  var headerRowIdx = 3;
  for(c=0;c<=lastCol;c++){
    styleCell(headerRowIdx, c, { font:{bold:true, color:{rgb:HEAD_FONT}, sz:10.5}, fill:{fgColor:{rgb:HEAD_FILL}}, alignment:{horizontal:"center", vertical:"center"}, border:borderAll });
  }

  for(var r=headerRowIdx+1; r<sumRowStart; r++){
    var rowArr = rows[r];
    if(!rowArr || rowArr.length===0) continue;
    var st = String(rowArr[3]||"");
    var isOff = st==="تعطیل هفتگی";
    var isMissing = st==="بدون ثبت";
    var isLeave = st.indexOf("مرخصی")===0;
    var isHol = st.indexOf("تعطیل رسمی")===0;
    var bg = isOff ? "F1EFE8" : isMissing ? "FBE7E4" : isHol ? "E4E7EC" : isLeave ? "F2E7D3" : (r%2===0? "FFFFFF":"F8F6F0");
    for(c=0;c<=lastCol;c++){
      styleCell(r,c,{ font:{sz:10.5}, fill:{fgColor:{rgb:bg}}, alignment:{horizontal: c<=1?"center":(c===8?"right":"center")}, border:borderAll });
    }
  }
  styleCell(sumRowStart,0,{ font:{bold:true, sz:12, color:{rgb:HEAD_FONT}}, fill:{fgColor:{rgb:"496A50"}}, alignment:{horizontal:"center"} });
  for(r=sumRowStart+1; r<rows.length; r++){
    styleCell(r,0,{ font:{bold:true, sz:10.5}, alignment:{horizontal:"right"} });
    styleCell(r,1,{ font:{sz:10.5}, alignment:{horizontal:"center"} });
  }

  ws['!autofilter'] = { ref: XLSX.utils.encode_range({s:{r:headerRowIdx,c:0}, e:{r:sumRowStart-2,c:lastCol}}) };

  var wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "تردد");

  var fname = "تردد-"+(name!=='—'?name.replace(/\s+/g,'_')+'-':'')+jy+'-'+pad2(jm)+".xlsx";
  return { wb: wb, fname: fname };
}

document.getElementById('btnExport').addEventListener('click', function(){
  if(typeof XLSX === 'undefined'){ showToast('کتابخانه اکسل بارگذاری نشد'); return; }
  var btn = document.getElementById('btnExport');
  btn.disabled = true;
  var built = buildReportWorkbook(repView.y, repView.m);
  var b64 = XLSX.write(built.wb, {type:'base64', bookType:'xlsx'});
  nativeSaveAndShare(built.fname, b64, false).then(function(handledNatively){
    if(!handledNatively){
      var bin = atob(b64);
      var buf = new Uint8Array(bin.length);
      for(var i=0;i<bin.length;i++) buf[i] = bin.charCodeAt(i);
      var blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      browserDownloadFallback(built.fname, blob);
    }
    btn.disabled = false;
  });
});

/* ---------------- Settings: weekdays, backup, restore, reset ---------------- */
var WD_LABELS = [
  {i:6,l:'شنبه'},{i:0,l:'یکشنبه'},{i:1,l:'دوشنبه'},{i:2,l:'سه‌شنبه'},
  {i:3,l:'چهارشنبه'},{i:4,l:'پنجشنبه'},{i:5,l:'جمعه'}
];
function renderWeekdayGrid(){
  var grid = document.getElementById('weekdayGrid');
  grid.innerHTML = WD_LABELS.map(function(w){
    var on = DATA.settings.workDays.indexOf(w.i)!==-1;
    return '<div class="wd-chip'+(on?' on':'')+'" data-i="'+w.i+'">'+w.l+'</div>';
  }).join('');
  Array.prototype.forEach.call(grid.querySelectorAll('.wd-chip'), function(chip){
    chip.addEventListener('click', function(){
      var i = parseInt(chip.getAttribute('data-i'),10);
      var idx = DATA.settings.workDays.indexOf(i);
      if(idx===-1) DATA.settings.workDays.push(i); else DATA.settings.workDays.splice(idx,1);
      saveData();
      chip.classList.toggle('on');
      renderToday(); renderCalendar();
    });
  });
}
document.getElementById('btnBackup').addEventListener('click', function(){
  var copy = JSON.parse(JSON.stringify(DATA));
  if(copy.settings && copy.settings.mizito){ copy.settings.mizito.token = ""; copy.settings.mizito.username = ""; copy.settings.mizito.passHash = ""; }
  var json = JSON.stringify(copy, null, 2);
  var fname = 'tarad-backup-'+todayKey()+'.json';
  nativeSaveAndShare(fname, json, true).then(function(handledNatively){
    if(!handledNatively){
      var blob = new Blob([json], {type:'application/json'});
      browserDownloadFallback(fname, blob);
    }
  });
});
document.getElementById('btnRestore').addEventListener('click', function(){
  document.getElementById('restoreFile').click();
});
document.getElementById('restoreFile').addEventListener('change', function(e){
  var file = e.target.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var d = JSON.parse(reader.result);
      if(!d.entries || !d.settings) throw new Error('bad file');
      var keep = DATA.settings.mizito || {};
      d.settings.mizito = d.settings.mizito || {};
      ["project","board","assignee"].forEach(function(k){ if(typeof d.settings.mizito[k] !== "string") d.settings.mizito[k] = keep[k] || ""; });
      d.settings.mizito.token = keep.token || ""; d.settings.mizito.username = keep.username || ""; d.settings.mizito.passHash = keep.passHash || "";
      DATA = d;
      saveData();
      showToast('بازیابی انجام شد');
      refreshAll();
    }catch(err){ showToast('فایل پشتیبان نامعتبر است'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});
document.getElementById('btnReset').addEventListener('click', function(){
  if(confirm('همه اطلاعات ثبت‌شده پاک شود؟ این عمل قابل بازگشت نیست.')){
    DATA = JSON.parse(JSON.stringify(DEFAULT_DATA));
    saveData();
    showToast('اطلاعات پاک شد');
    refreshAll();
  }
});

document.getElementById('btnParseCurl').addEventListener('click', function(){
  var text = document.getElementById('mzCurlInput').value;
  var parsed = parseMizitoCurl(text);
  var note = document.getElementById('mzParseNote');
  if(!parsed){
    note.className = 'mz-note err';
    note.textContent = 'متن cURL شناسایی نشد — مطمئن شوید کل دستور (شامل -H و --data-raw) را کپی کرده‌اید';
    return;
  }
  var cur = DATA.settings.mizito;
  DATA.settings.mizito = {
    token: parsed.token || cur.token || "", project: parsed.project, board: parsed.board, assignee: parsed.assignee,
    username: cur.username || "", passHash: cur.passHash || ""
  };
  saveData();
  note.className = 'mz-note ok';
  note.textContent = 'با موفقیت استخراج و ذخیره شد ✓';
  document.getElementById('mzCurlInput').value = '';
  renderSettings();
  renderReport();
});
document.getElementById('btnParseLogin').addEventListener('click', function(){
  var note = document.getElementById('mzLoginNote');
  var p = parseMizitoLogin(document.getElementById('mzLoginInput').value);
  if(!p){
    note.className = 'mz-note err';
    note.textContent = 'نام کاربری و رمز در متن پیدا نشد — cURL درخواست «session/create» (یا خود JSON آن) را جای‌گذاری کنید';
    return;
  }
  DATA.settings.mizito.username = p.username;
  DATA.settings.mizito.passHash = p.passHash;
  saveData();
  document.getElementById('mzLoginInput').value = '';
  note.className = 'mz-note ok';
  note.textContent = 'ذخیره شد ✓ — برای اطمینان «آزمایش ورود» را بزنید';
  renderSettings(); renderReport();
});
['mzUser','mzPass'].forEach(function(id){
  document.getElementById(id).addEventListener('change', function(){
    DATA.settings.mizito[id === 'mzUser' ? 'username' : 'passHash'] = this.value.trim();
    saveData(); renderSettings(); renderReport();
  });
});
document.getElementById('btnTestLogin').addEventListener('click', function(){
  var btn = this, note = document.getElementById('mzLoginNote');
  btn.disabled = true; note.className = 'mz-note'; note.textContent = 'در حال ورود...';
  mzLogin().then(function(){
    btn.disabled = false; note.className = 'mz-note ok';
    note.textContent = 'ورود موفق بود و توکن جدید گرفته شد ✓'; renderReport();
  }).catch(function(err){
    btn.disabled = false; note.className = 'mz-note err'; note.textContent = mzErrMessage(err);
  });
});
document.getElementById('btnClearLogin').addEventListener('click', function(){
  if(!confirm('نام کاربری، رمز و توکن میزیتو از این گوشی پاک شود؟')) return;
  var m = DATA.settings.mizito; m.username = ""; m.passHash = ""; m.token = "";
  saveData(); renderSettings(); renderReport();
  showToast('اطلاعات ورود پاک شد');
});
['mzProject','mzBoard','mzAssignee'].forEach(function(id){
  document.getElementById(id).addEventListener('change', function(){
    var key = id === 'mzProject' ? 'project' : id === 'mzBoard' ? 'board' : 'assignee';
    DATA.settings.mizito[key] = this.value.trim();
    saveData();
    renderReport();
  });
});

/* ---------------- Init ---------------- */function refreshAll(){
  renderTopDate();
  renderToday();
  renderCalendar();
  renderReport();
  renderSettings();
}
setInterval(renderTopDate, 60000);
refreshAll();

// expose a couple of internals for debugging via the app's own devtools, harmless in production
window.__tardod = { DATA: DATA, aggregateMonth: aggregateMonth, jalaliPartsOf: jalaliPartsOf, jalaliMonthInfo: jalaliMonthInfo, calView: calView, repView: repView, buildReportWorkbook: buildReportWorkbook };

})();
