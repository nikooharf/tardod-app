(function(){
"use strict";

/* ---------------- Storage ---------------- */
var STORE_KEY = "tarad_data_v2";
var DEFAULT_DATA = {
  settings: {
    employeeName: "", stdHours: 8, workDays: [6,0,1,2,3],
    leaveCaps: { استحقاقی: 26, استعلاجی: 15, بدون‌حقوق: 0, اداری: 0 },
    reminder: { enabled: true, afterMinutes: 90 },
    mizito: { token: "", project: "", board: "", assignee: "", username: "", passHash: "" }
  },
  entries: {}
};
var REMINDER_NOTIF_ID = 71001;
var LEAVE_TYPES = ['استحقاقی','استعلاجی','بدون‌حقوق','اداری'];
function loadData(){
  try{
    var raw = localStorage.getItem(STORE_KEY);
    if(!raw) return JSON.parse(JSON.stringify(DEFAULT_DATA));
    var d = JSON.parse(raw);
    if(!d.settings) d.settings = JSON.parse(JSON.stringify(DEFAULT_DATA.settings));
    if(!d.entries) d.entries = {};
    if(typeof d.settings.stdHours !== "number") d.settings.stdHours = 8;
    if(!Array.isArray(d.settings.workDays)) d.settings.workDays = [6,0,1,2,3];
    if(!d.settings.leaveCaps || typeof d.settings.leaveCaps !== 'object'){
      d.settings.leaveCaps = JSON.parse(JSON.stringify(DEFAULT_DATA.settings.leaveCaps));
    }
    LEAVE_TYPES.forEach(function(t){
      var v = d.settings.leaveCaps[t];
      d.settings.leaveCaps[t] = (typeof v === 'number' && v >= 0) ? v : (DEFAULT_DATA.settings.leaveCaps[t] || 0);
    });
    if(!d.settings.reminder || typeof d.settings.reminder !== 'object'){
      d.settings.reminder = JSON.parse(JSON.stringify(DEFAULT_DATA.settings.reminder));
    }
    if(typeof d.settings.reminder.enabled !== 'boolean') d.settings.reminder.enabled = true;
    if(typeof d.settings.reminder.afterMinutes !== 'number' || d.settings.reminder.afterMinutes < 15){
      d.settings.reminder.afterMinutes = 90;
    }
    if(!d.settings.mizito) d.settings.mizito = { token:"", project:"", board:"", assignee:"" };
    ["token","project","board","assignee","username","passHash"].forEach(function(k){
      if(typeof d.settings.mizito[k] !== "string") d.settings.mizito[k] = "";
    });
    var dirty = false;
    Object.keys(d.entries).forEach(function(k){
      var prev = d.entries[k];
      var next = normalizeEntry(prev);
      if(!Array.isArray(prev && prev.sessions)) dirty = true;
      d.entries[k] = next;
    });
    if(dirty){
      try{ localStorage.setItem(STORE_KEY, JSON.stringify(d)); }catch(e){}
    }
    return d;
  }catch(e){ return JSON.parse(JSON.stringify(DEFAULT_DATA)); }
}
function saveData(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(DATA)); }catch(e){ showToast("ذخیره‌سازی ناموفق بود"); }
}
var DATA = null; // set after helpers below

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

/* ---------------- Entry helpers (multi-session day model) ---------------- */
function emptyEntry(){
  return { sessions: [], leave: null, holiday: null, note: "", nextMode: "normal" };
}
function normalizeSession(s){
  if(!s || !s.checkIn) return null;
  return {
    checkIn: String(s.checkIn),
    checkOut: s.checkOut ? String(s.checkOut) : null,
    mode: s.mode === 'remote' ? 'remote' : 'normal'
  };
}
function normalizeLeave(leave){
  if(!leave || typeof leave !== 'object') return null;
  var lt = leave.leaveType || 'استحقاقی';
  if(LEAVE_TYPES.indexOf(lt) === -1) lt = 'استحقاقی';
  if(leave.kind === 'full') return { kind: 'full', leaveType: lt };
  if(leave.kind === 'hours'){
    return { kind: 'hours', leaveType: lt, leaveMinutes: Math.max(0, Math.round(leave.leaveMinutes || 0)) };
  }
  return null;
}
function migrateLegacyEntry(raw){
  var e = emptyEntry();
  e.note = typeof raw.note === 'string' ? raw.note : "";
  if(raw.mizitoSentAt) e.mizitoSentAt = raw.mizitoSentAt;
  if(raw.mizitoTaskId) e.mizitoTaskId = raw.mizitoTaskId;
  if(raw.type === 'normal' || raw.type === 'remote'){
    e.nextMode = raw.type === 'remote' ? 'remote' : 'normal';
    if(raw.checkIn){
      e.sessions = [{
        checkIn: String(raw.checkIn),
        checkOut: raw.checkOut ? String(raw.checkOut) : null,
        mode: raw.type === 'remote' ? 'remote' : 'normal'
      }];
    }
  } else if(raw.type === 'leave_full'){
    e.leave = { kind: 'full', leaveType: raw.leaveType || 'استحقاقی' };
  } else if(raw.type === 'leave_hours'){
    e.leave = {
      kind: 'hours',
      leaveType: raw.leaveType || 'استحقاقی',
      leaveMinutes: Math.max(0, Math.round(raw.leaveMinutes || 0))
    };
  } else if(raw.type === 'holiday'){
    e.holiday = { title: raw.holidayTitle || "" };
  }
  return e;
}
function normalizeEntry(raw){
  if(!raw) return null;
  if(!Array.isArray(raw.sessions)) return migrateLegacyEntry(raw);
  var e = emptyEntry();
  e.sessions = raw.sessions.map(normalizeSession).filter(Boolean);
  e.leave = normalizeLeave(raw.leave);
  if(raw.holiday && typeof raw.holiday === 'object'){
    e.holiday = { title: raw.holiday.title || "" };
  } else {
    e.holiday = null;
  }
  e.note = typeof raw.note === 'string' ? raw.note : "";
  e.nextMode = raw.nextMode === 'remote' ? 'remote' : 'normal';
  if(raw.mizitoSentAt) e.mizitoSentAt = raw.mizitoSentAt;
  if(raw.mizitoTaskId) e.mizitoTaskId = raw.mizitoTaskId;
  if(e.holiday){ e.sessions = []; e.leave = null; }
  return e;
}
function entryHasContent(entry){
  if(!entry) return false;
  if(entry.holiday) return true;
  if(entry.leave) return true;
  if(entry.sessions && entry.sessions.length) return true;
  if(entry.note) return true;
  return false;
}
function entrySessions(entry){ return (entry && Array.isArray(entry.sessions)) ? entry.sessions : []; }
function entryLeave(entry){ return entry && entry.leave ? entry.leave : null; }
function openSession(entry){
  var ss = entrySessions(entry);
  if(!ss.length) return null;
  var last = ss[ss.length - 1];
  return last.checkOut ? null : last;
}
function sessionWorkedMinutes(s){
  if(!s || !s.checkIn || !s.checkOut) return 0;
  var mins = minutesBetween(s.checkIn, s.checkOut);
  return mins == null ? 0 : mins;
}
function timeToMinutes(t){
  if(!t) return null;
  var p = String(t).split(':').map(Number);
  return p[0]*60 + p[1];
}
function validateSessions(sessions){
  for(var i = 0; i < sessions.length; i++){
    var s = sessions[i];
    if(!s.checkIn) return 'ساعت ورود جلسه '+(i+1)+' را وارد کنید';
    if(!s.checkOut && i !== sessions.length - 1) return 'فقط آخرین جلسه می‌تواند بدون خروج باشد';
    if(i > 0){
      var prev = sessions[i - 1];
      if(!prev.checkOut) return 'جلسه قبلی هنوز باز است';
      var prevStart = timeToMinutes(prev.checkIn);
      var prevEnd = timeToMinutes(prev.checkOut);
      var start = timeToMinutes(s.checkIn);
      if(prevEnd < prevStart) prevEnd += 24 * 60;
      if(start < prevEnd) return 'زمان جلسات هم‌پوشانی دارد';
    }
  }
  return null;
}
function getEntry(key){ return DATA.entries[key] || null; }
function setEntry(key, entry){
  var n = normalizeEntry(entry);
  if(!entryHasContent(n)){
    if(n.nextMode === 'remote'){
      DATA.entries[key] = { sessions: [], leave: null, holiday: null, note: "", nextMode: "remote" };
      saveData();
      return;
    }
    removeEntry(key);
    return;
  }
  DATA.entries[key] = n;
  saveData();
}
function removeEntry(key){ delete DATA.entries[key]; saveData(); }
function isWeeklyWorkDay(date){ return DATA.settings.workDays.indexOf(date.getDay()) !== -1; }
// Work-day quota: weekly work day, not official holiday, and not leave-only full day.
function isEffectiveWorkDay(date){
  var entry = getEntry(dateKeyOf(date));
  if(entry && entry.holiday) return false;
  if(entry && entry.leave && entry.leave.kind === 'full' && entrySessions(entry).length === 0) return false;
  return isWeeklyWorkDay(date);
}

function entryWorkedMinutes(entry){
  if(!entry || entry.holiday) return 0;
  var sessions = entrySessions(entry);
  var fromSessions = 0;
  for(var i = 0; i < sessions.length; i++) fromSessions += sessionWorkedMinutes(sessions[i]);
  if(fromSessions > 0) return fromSessions;
  var leave = entryLeave(entry);
  if(leave && leave.kind === 'hours'){
    var std = DATA.settings.stdHours * 60;
    return Math.max(0, std - (leave.leaveMinutes || 0));
  }
  return 0;
}
function entryStatusText(entry){
  if(!entry) return '';
  if(entry.holiday){
    return 'تعطیل رسمی' + (entry.holiday.title ? (' — ' + entry.holiday.title) : '');
  }
  var parts = [];
  var hasN = false, hasR = false;
  entrySessions(entry).forEach(function(s){
    if(s.mode === 'remote') hasR = true; else hasN = true;
  });
  if(hasN) parts.push('حضوری');
  if(hasR) parts.push('دورکاری');
  var leave = entryLeave(entry);
  if(leave){
    if(leave.kind === 'full') parts.push('مرخصی ('+(leave.leaveType || 'استحقاقی')+')');
    else parts.push('مرخصی ساعتی');
  }
  return parts.join(' + ');
}
function entryTimesJoined(entry){
  var sessions = entrySessions(entry);
  if(!sessions.length) return { cin: '', cout: '' };
  return {
    cin: sessions.map(function(s){ return s.checkIn || '—'; }).join('؛ '),
    cout: sessions.map(function(s){ return s.checkOut || '—'; }).join('؛ ')
  };
}
function entryDetailText(entry){
  if(!entry) return '';
  if(entry.holiday) return entry.holiday.title || 'تعطیل رسمی';
  var bits = [];
  var sessions = entrySessions(entry);
  if(sessions.length){
    bits.push(sessions.map(function(s){
      return (s.checkIn || '—') + '–' + (s.checkOut || '—');
    }).join('؛ '));
  }
  var leave = entryLeave(entry);
  if(leave){
    if(leave.kind === 'full') bits.push(leave.leaveType || 'مرخصی');
    else bits.push(((leave.leaveMinutes || 0) / 60) + ' ساعت مرخصی');
  }
  return bits.join(' · ');
}
function typeBadgeLabel(entry, date){
  if(!entry || !entryHasContent(entry)){
    return isWeeklyWorkDay(date) ? {cls:'missing', text:'ثبت نشده'} : {cls:'missing', text:'تعطیل هفتگی'};
  }
  if(entry.holiday){
    return {cls:'holiday', text: entry.holiday.title ? 'تعطیل رسمی — '+entry.holiday.title : 'تعطیل رسمی'};
  }
  var sessions = entrySessions(entry);
  var leave = entryLeave(entry);
  var hasWork = sessions.length > 0;
  if(hasWork && leave){
    return {cls:'leave', text: sessions.length > 1 ? ('مرخصی+'+sessions.length+' جلسه') : 'مرخصی+کار'};
  }
  if(leave){
    if(leave.kind === 'full') return {cls:'leave', text:'مرخصی ('+(leave.leaveType||'استحقاقی')+')'};
    return {cls:'leave', text:'مرخصی ساعتی ('+((leave.leaveMinutes||0)/60)+' س)'};
  }
  if(sessions.length > 1){
    var mixed = sessions.some(function(s){ return s.mode === 'remote'; }) &&
                sessions.some(function(s){ return s.mode !== 'remote'; });
    return {cls: mixed ? 'remote' : (sessions[0].mode === 'remote' ? 'remote' : 'normal'), text: sessions.length+' جلسه'};
  }
  if(sessions.length === 1){
    return sessions[0].mode === 'remote'
      ? {cls:'remote', text:'دورکاری'}
      : {cls:'normal', text:'حضوری'};
  }
  return {cls:'missing', text:'—'};
}

DATA = loadData();

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
    if(entry && entryHasContent(entry)){
      if(entry.holiday){
        holidayDays++;
      } else {
        workedMinutes += entryWorkedMinutes(entry);
        var leave = entryLeave(entry);
        if(leave){
          if(leave.kind === 'full'){
            leaveDays++;
            leaveByType[leave.leaveType||'استحقاقی'] = (leaveByType[leave.leaveType||'استحقاقی']||0)+1;
          } else if(leave.kind === 'hours'){
            leaveHoursTotal += (leave.leaveMinutes||0);
          }
        }
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

function leaveDayEquivalent(leave){
  if(!leave) return 0;
  if(leave.kind === 'full') return 1;
  var std = DATA.settings.stdHours * 60;
  if(!std) return 0;
  return (leave.leaveMinutes || 0) / std;
}
function aggregateYearLeave(jy){
  var used = {};
  LEAVE_TYPES.forEach(function(t){ used[t] = 0; });
  Object.keys(DATA.entries).forEach(function(key){
    var p = jalaliPartsOf(keyToDate(key));
    if(p.y !== jy) return;
    var leave = entryLeave(getEntry(key));
    if(!leave) return;
    var t = leave.leaveType || 'استحقاقی';
    if(used[t] == null) used[t] = 0;
    used[t] += leaveDayEquivalent(leave);
  });
  return used;
}
function fmtLeaveDays(n){
  var x = Math.round((n || 0) * 100) / 100;
  return (x % 1 === 0) ? String(x) : x.toFixed(2);
}
function entryMatchesFilter(entry, date, filter){
  if(filter === 'all' || !filter) return true;
  if(!entry || !entryHasContent(entry)) return false;
  if(filter === 'remote'){
    return entrySessions(entry).some(function(s){ return s.mode === 'remote'; });
  }
  if(filter === 'leave') return !!entryLeave(entry);
  if(filter === 'overtime'){
    var mins = entryWorkedMinutes(entry);
    return mins > DATA.settings.stdHours * 60;
  }
  return true;
}
function filterLabel(filter){
  if(filter === 'remote') return 'دورکاری';
  if(filter === 'leave') return 'مرخصی';
  if(filter === 'overtime') return 'اضافه‌کار';
  return 'همه';
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
  var remoteBtn = document.getElementById('btnRemoteToggle');

  clearInterval(clockTimer);

  var open = openSession(entry);
  var sessions = entrySessions(entry);
  var leave = entryLeave(entry);
  var nextMode = (entry && entry.nextMode === 'remote') ? 'remote' : 'normal';
  if(open) nextMode = open.mode;
  remoteBtn.textContent = nextMode === 'remote' ? 'حضوری بعدی' : 'دورکاری بعدی';

  if(entry && entry.holiday){
    statusLabel.textContent = 'امروز تعطیل رسمی است';
    liveClock.textContent = entry.holiday.title || 'تعطیل رسمی';
    sub.textContent = entry.note ? entry.note : 'برای تغییر، ویرایش دستی را بزنید';
    btn.style.display = 'none';
  } else if(open){
    statusLabel.textContent = (open.mode==='remote'?'دورکاری — ':'')+'در حال کار از ساعت '+open.checkIn;
    if(sessions.length > 1 || leave){
      statusLabel.textContent += sessions.length > 1 ? (' (جلسه '+sessions.length+')') : '';
    }
    btn.style.display = 'flex';
    btn.className = 'stamp-btn out';
    btnLabel.textContent = 'ثبت خروج';
    btn.disabled = false;
    (function(){
      function tick(){
        var mins = minutesBetween(open.checkIn, new Date().toTimeString().slice(0,5));
        liveClock.textContent = fmtMinutesShort(mins);
        var parts = ['مدت حضور تا این لحظه'];
        if(leave){
          parts.push(leave.kind==='full' ? ('مرخصی '+ (leave.leaveType||'')) : (((leave.leaveMinutes||0)/60)+' س مرخصی'));
        }
        sub.textContent = parts.join(' · ');
      }
      tick();
      clockTimer = setInterval(tick, 15000);
    })();
  } else if(sessions.length || leave){
    var worked = entryWorkedMinutes(entry);
    statusLabel.textContent = entryStatusText(entry) || 'امروز ثبت شده';
    liveClock.textContent = fmtMinutesShort(worked);
    sub.textContent = entryDetailText(entry) || (entry.note || 'می‌توانید جلسهٔ جدید ثبت کنید');
    btn.style.display = 'flex';
    btn.className = 'stamp-btn in';
    btnLabel.textContent = 'ثبت ورود جدید';
    btn.disabled = false;
  } else {
    statusLabel.textContent = 'هنوز ورود ثبت نشده';
    liveClock.textContent = new Date().toTimeString().slice(0,5);
    clockTimer = setInterval(function(){ liveClock.textContent = new Date().toTimeString().slice(0,5); }, 1000*20);
    sub.textContent = nextMode === 'remote' ? 'ورود بعدی به‌عنوان دورکاری ثبت می‌شود' : 'برای شروع، ورود را ثبت کنید';
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
  var entry = getEntry(key) || emptyEntry();
  if(entry.holiday){ showToast('امروز تعطیل رسمی است — ابتدا آن را ویرایش کنید'); return; }
  var now = new Date().toTimeString().slice(0,5);
  var open = openSession(entry);
  if(open){
    open.checkOut = now;
    setEntry(key, entry);
    showToast('خروج ثبت شد: '+now);
  } else {
    var mode = entry.nextMode === 'remote' ? 'remote' : 'normal';
    entry.sessions.push({ checkIn: now, checkOut: null, mode: mode });
    setEntry(key, entry);
    showToast((mode==='remote'?'دورکاری — ':'')+'ورود ثبت شد: '+now);
  }
  syncOpenSessionReminder();
  renderToday();
});

document.getElementById('btnRemoteToggle').addEventListener('click', function(){
  var key = todayKey();
  var entry = getEntry(key) || emptyEntry();
  if(entry.holiday){ showToast('امروز تعطیل رسمی است — ابتدا آن را ویرایش کنید'); return; }
  var open = openSession(entry);
  if(open){
    open.mode = open.mode === 'remote' ? 'normal' : 'remote';
    entry.nextMode = open.mode;
    setEntry(key, entry);
    showToast(open.mode === 'remote' ? 'این جلسه دورکاری شد' : 'این جلسه حضوری شد');
  } else {
    entry.nextMode = entry.nextMode === 'remote' ? 'normal' : 'remote';
    setEntry(key, entry);
    showToast(entry.nextMode === 'remote' ? 'ورود بعدی دورکاری خواهد بود' : 'ورود بعدی حضوری خواهد بود');
  }
  renderToday();
});

document.getElementById('btnLeaveToday').addEventListener('click', function(){ openSheet(todayKey(), null, 'leave'); });
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
    var isHoliday = !!(entry && entry.holiday);
    var badge = typeBadgeLabel(entry, date);
    var detail = '';
    if(entry && entryHasContent(entry)){
      detail = entryDetailText(entry) || entry.note || '—';
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
  if(entry.holiday){
    lines.push('تعطیل رسمی'+(entry.holiday.title ? (': '+entry.holiday.title) : ''));
  } else {
    var sessions = entrySessions(entry);
    sessions.forEach(function(s, idx){
      var label = s.mode === 'remote' ? 'دورکاری' : 'حضوری';
      if(sessions.length === 1){
        lines.push(label);
        lines.push('ساعت ورود: '+(s.checkIn||'—'));
        lines.push('ساعت خروج: '+(s.checkOut||'—'));
      } else {
        lines.push('جلسه '+(idx+1)+' ('+label+'): '+(s.checkIn||'—')+' – '+(s.checkOut||'—'));
      }
    });
    var leave = entryLeave(entry);
    if(leave){
      if(leave.kind === 'full') lines.push('مرخصی روزانه ('+(leave.leaveType||'استحقاقی')+')');
      else lines.push('مرخصی ساعتی: '+((leave.leaveMinutes||0)/60)+' ساعت');
    }
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
  if(!mizitoConfigured() || !entry || !entryHasContent(entry)) return Promise.resolve({ok:false, message:'تنظیمات میزیتو کامل نیست'});
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
    var ent = getEntry(key);
    if(ent && entryHasContent(ent)) keys.push(key);
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
var sheetSessions = [];
var sheetFocusLeave = false;

function renderSheetSessions(){
  var box = document.getElementById('sheetSessions');
  if(!sheetSessions.length){
    box.innerHTML = '<div class="session-empty">جلسه‌ای ثبت نشده — «افزودن جلسه» را بزنید</div>';
    return;
  }
  box.innerHTML = sheetSessions.map(function(s, i){
    return '<div class="session-row" data-i="'+i+'">'+
      '<div class="session-head"><span>جلسه '+(i+1)+'</span>'+
      '<button type="button" class="session-del" data-del="'+i+'">حذف</button></div>'+
      '<div class="time-row">'+
      '<div class="field"><label>ورود</label><input type="time" data-f="in" data-i="'+i+'" value="'+(s.checkIn||'')+'"></div>'+
      '<div class="field"><label>خروج</label><input type="time" data-f="out" data-i="'+i+'" value="'+(s.checkOut||'')+'"></div>'+
      '</div>'+
      '<div class="seg session-mode" data-i="'+i+'">'+
      '<button type="button" data-mode="normal"'+(s.mode!=='remote'?' class="on"':'')+'>حضوری</button>'+
      '<button type="button" data-mode="remote"'+(s.mode==='remote'?' class="on"':'')+'>دورکاری</button>'+
      '</div></div>';
  }).join('');
  Array.prototype.forEach.call(box.querySelectorAll('input[type=time]'), function(inp){
    inp.addEventListener('change', function(){
      var i = parseInt(inp.getAttribute('data-i'), 10);
      var f = inp.getAttribute('data-f');
      if(f === 'in') sheetSessions[i].checkIn = inp.value || '';
      else sheetSessions[i].checkOut = inp.value || null;
    });
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-del]'), function(b){
    b.addEventListener('click', function(){
      sheetSessions.splice(parseInt(b.getAttribute('data-del'), 10), 1);
      renderSheetSessions();
    });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.session-mode button'), function(b){
    b.addEventListener('click', function(){
      var row = b.parentNode;
      var i = parseInt(row.getAttribute('data-i'), 10);
      sheetSessions[i].mode = b.getAttribute('data-mode');
      Array.prototype.forEach.call(row.querySelectorAll('button'), function(x){
        x.classList.toggle('on', x === b);
      });
    });
  });
}
function setSheetLeaveKind(kind){
  Array.prototype.forEach.call(document.querySelectorAll('#segLeave button'), function(b){
    b.classList.toggle('on', b.getAttribute('data-v') === kind);
  });
  document.getElementById('blockLeaveType').style.display = (kind === 'full' || kind === 'hours') ? 'block' : 'none';
  document.getElementById('blockLeaveHours').style.display = kind === 'hours' ? 'block' : 'none';
}
function setSheetHoliday(on){
  document.getElementById('chkHoliday').checked = !!on;
  document.getElementById('blockWorkLeave').style.display = on ? 'none' : 'block';
  document.getElementById('blockHolidayNote').style.display = on ? 'block' : 'none';
}
function openSheet(key, forceHoliday, focus){
  sheetKey = key;
  sheetFocusLeave = focus === 'leave';
  var date = keyToDate(key);
  var entry = getEntry(key);
  document.getElementById('sheetTitle').textContent = jalaliLabel(date)+' — '+weekdayFmt.format(date);
  var asHoliday = forceHoliday === 'holiday' || !!(entry && entry.holiday);
  sheetSessions = entry ? entrySessions(entry).map(function(s){
    return { checkIn: s.checkIn || '', checkOut: s.checkOut || '', mode: s.mode === 'remote' ? 'remote' : 'normal' };
  }) : [];
  if(!asHoliday && !sheetSessions.length && !entry && isWeeklyWorkDay(date) && !sheetFocusLeave){
    sheetSessions = [{ checkIn: '', checkOut: '', mode: 'normal' }];
  }
  renderSheetSessions();
  var leave = entry ? entryLeave(entry) : null;
  var leaveKind = leave ? leave.kind : 'none';
  if(sheetFocusLeave && leaveKind === 'none') leaveKind = 'full';
  setSheetLeaveKind(leaveKind);
  document.getElementById('fLeaveType').value = (leave && leave.leaveType) || 'استحقاقی';
  document.getElementById('fLeaveHours').value = (leave && leave.kind === 'hours' && leave.leaveMinutes)
    ? (leave.leaveMinutes / 60) : 4;
  document.getElementById('fHolidayTitle').value = (entry && entry.holiday && entry.holiday.title) || '';
  document.getElementById('fNote').value = (entry && entry.note) || '';
  setSheetHoliday(asHoliday);
  document.getElementById('btnDeleteEntry').style.display = entry && entryHasContent(entry) ? 'block' : 'none';
  var mzRow = document.getElementById('mzSendRow');
  var mzNote = document.getElementById('mzSendNote');
  if(mizitoConfigured() && entry && entryHasContent(entry)){
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

document.getElementById('btnAddSession').addEventListener('click', function(){
  sheetSessions.push({ checkIn: '', checkOut: '', mode: 'normal' });
  renderSheetSessions();
});
Array.prototype.forEach.call(document.querySelectorAll('#segLeave button'), function(b){
  b.addEventListener('click', function(){ setSheetLeaveKind(b.getAttribute('data-v')); });
});
document.getElementById('chkHoliday').addEventListener('change', function(){
  setSheetHoliday(this.checked);
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
  syncOpenSessionReminder();
  refreshAll();
});
document.getElementById('btnSaveEntry').addEventListener('click', function(){
  if(!sheetKey) return;
  var prev = getEntry(sheetKey);
  if(document.getElementById('chkHoliday').checked){
    var hol = {
      sessions: [], leave: null,
      holiday: { title: document.getElementById('fHolidayTitle').value.trim() },
      note: document.getElementById('fNote').value.trim(),
      nextMode: 'normal'
    };
    if(prev && prev.mizitoSentAt) hol.mizitoSentAt = prev.mizitoSentAt;
    if(prev && prev.mizitoTaskId) hol.mizitoTaskId = prev.mizitoTaskId;
    setEntry(sheetKey, hol);
    showToast(sheetKey===todayKey() ? 'ذخیره شد' : 'برای '+jalaliLabel(keyToDate(sheetKey))+' ذخیره شد');
    closeSheet();
    syncOpenSessionReminder();
    refreshAll();
    return;
  }
  var sessions = sheetSessions.map(function(s){
    return {
      checkIn: s.checkIn || '',
      checkOut: s.checkOut || null,
      mode: s.mode === 'remote' ? 'remote' : 'normal'
    };
  }).filter(function(s){ return !!s.checkIn; });
  var verr = validateSessions(sessions);
  if(verr){ showToast(verr); return; }
  var leaveKind = 'none';
  Array.prototype.forEach.call(document.querySelectorAll('#segLeave button'), function(b){
    if(b.classList.contains('on')) leaveKind = b.getAttribute('data-v');
  });
  var leave = null;
  if(leaveKind === 'full'){
    leave = { kind: 'full', leaveType: document.getElementById('fLeaveType').value };
  } else if(leaveKind === 'hours'){
    var hrs = parseFloat(document.getElementById('fLeaveHours').value) || 0;
    leave = {
      kind: 'hours',
      leaveType: document.getElementById('fLeaveType').value,
      leaveMinutes: Math.round(hrs * 60)
    };
  }
  if(!sessions.length && !leave && !document.getElementById('fNote').value.trim()){
    removeEntry(sheetKey);
    showToast('ثبت روز پاک شد');
    closeSheet();
    refreshAll();
    return;
  }
  var entry = {
    sessions: sessions,
    leave: leave,
    holiday: null,
    note: document.getElementById('fNote').value.trim(),
    nextMode: (prev && prev.nextMode === 'remote') ? 'remote' : 'normal'
  };
  if(prev && prev.mizitoSentAt) entry.mizitoSentAt = prev.mizitoSentAt;
  if(prev && prev.mizitoTaskId) entry.mizitoTaskId = prev.mizitoTaskId;
  setEntry(sheetKey, entry);
  showToast(sheetKey===todayKey() ? 'ذخیره شد' : 'برای '+jalaliLabel(keyToDate(sheetKey))+' ذخیره شد');
  closeSheet();
  syncOpenSessionReminder();
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
  openSheet(v, 'holiday', null);
});

/* ---------------- Settings (name / standard hours — full settings in a later phase) ---------------- */
function renderSettings(){
  document.getElementById('setName').value = DATA.settings.employeeName || '';
  document.getElementById('setStdHours').value = DATA.settings.stdHours;
  var caps = DATA.settings.leaveCaps || {};
  document.getElementById('setLeaveEntitled').value = caps['استحقاقی'] != null ? caps['استحقاقی'] : 26;
  document.getElementById('setLeaveSick').value = caps['استعلاجی'] != null ? caps['استعلاجی'] : 15;
  document.getElementById('setLeaveUnpaid').value = caps['بدون‌حقوق'] != null ? caps['بدون‌حقوق'] : 0;
  document.getElementById('setLeaveAdmin').value = caps['اداری'] != null ? caps['اداری'] : 0;
  var rem = DATA.settings.reminder || DEFAULT_DATA.settings.reminder;
  document.getElementById('setReminderEnabled').checked = !!rem.enabled;
  document.getElementById('setReminderMinutes').value = rem.afterMinutes || 90;
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
function bindLeaveCapInput(id, typeKey){
  document.getElementById(id).addEventListener('change', function(){
    var v = parseFloat(this.value);
    if(isNaN(v) || v < 0) v = 0;
    DATA.settings.leaveCaps[typeKey] = Math.round(v);
    saveData();
    renderReport();
  });
}
bindLeaveCapInput('setLeaveEntitled', 'استحقاقی');
bindLeaveCapInput('setLeaveSick', 'استعلاجی');
bindLeaveCapInput('setLeaveUnpaid', 'بدون‌حقوق');
bindLeaveCapInput('setLeaveAdmin', 'اداری');
document.getElementById('setReminderEnabled').addEventListener('change', function(){
  DATA.settings.reminder.enabled = !!this.checked;
  saveData();
  syncOpenSessionReminder();
});
document.getElementById('setReminderMinutes').addEventListener('change', function(){
  var v = parseInt(this.value, 10);
  if(!v || v < 15) v = 15;
  if(v > 720) v = 720;
  DATA.settings.reminder.afterMinutes = v;
  this.value = v;
  saveData();
  syncOpenSessionReminder();
});

/* ---------------- REPORT view ---------------- */
var repView = jalaliPartsOf(new Date());
var repFilter = 'all';
function rstat(n,l){ return '<div class="rstat"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>'; }
function collectFilteredMonthDays(jy, jm, filter){
  var info = jalaliMonthInfo(jy, jm);
  var list = [];
  for(var d=1; d<=info.days; d++){
    var date = new Date(info.start.getTime());
    date.setDate(date.getDate()+(d-1));
    var key = dateKeyOf(date);
    var entry = getEntry(key);
    if(!entryMatchesFilter(entry, date, filter)) continue;
    if(filter !== 'all' && (!entry || !entryHasContent(entry))) continue;
    list.push({ d:d, date:date, key:key, entry:entry });
  }
  return list;
}
function renderReport(){
  var info = jalaliMonthInfo(repView.y, repView.m);
  document.getElementById('repMonthTitle').textContent = info.name+' '+repView.y;
  Array.prototype.forEach.call(document.querySelectorAll('#segRepFilter button'), function(b){
    b.classList.toggle('on', b.getAttribute('data-v') === repFilter);
  });
  var hint = document.getElementById('repFilterHint');
  if(repFilter === 'all'){
    hint.textContent = 'همهٔ روزهای ماه در خلاصه و اکسل می‌آید.';
  } else {
    hint.textContent = 'خلاصهٔ پایین و اکسل فقط روزهای «'+filterLabel(repFilter)+'» را نشان می‌دهد.';
  }

  var matched = collectFilteredMonthDays(repView.y, repView.m, repFilter);
  var workedMinutes = 0, leaveDays = 0, leaveHoursTotal = 0, holidayDays = 0, otDays = 0;
  matched.forEach(function(item){
    var entry = item.entry;
    if(!entry || !entryHasContent(entry)) return;
    if(entry.holiday){ holidayDays++; return; }
    workedMinutes += entryWorkedMinutes(entry);
    var leave = entryLeave(entry);
    if(leave){
      if(leave.kind === 'full') leaveDays++;
      else leaveHoursTotal += (leave.leaveMinutes || 0);
    }
    if(entryWorkedMinutes(entry) > DATA.settings.stdHours * 60) otDays++;
  });

  if(repFilter === 'all'){
    var agg = aggregateMonth(repView.y, repView.m);
    document.getElementById('repGrid').innerHTML =
      rstat(fmtHours(agg.workedMinutes),'جمع کارکرد') +
      rstat(fmtHours(agg.overtimeMinutes), (agg.overtimeMinutes>=0?'اضافه‌کاری':'کسری کارکرد')) +
      rstat(agg.leaveDays+' روز','مرخصی روزانه') +
      rstat(agg.holidayDays+' روز','تعطیل رسمی') +
      rstat(agg.missingDays+' روز','بدون ثبت');
  } else {
    document.getElementById('repGrid').innerHTML =
      rstat(matched.length+' روز','تعداد مطابق فیلتر') +
      rstat(fmtHours(workedMinutes),'جمع کارکرد فیلتر') +
      rstat(leaveDays+' روز','مرخصی روزانه') +
      rstat(fmtHours(leaveHoursTotal),'مرخصی ساعتی') +
      rstat(otDays+' روز','روز اضافه‌کار');
  }

  document.getElementById('repLeaveYearLabel').textContent = repView.y;
  var usedYear = aggregateYearLeave(repView.y);
  var caps = DATA.settings.leaveCaps || {};
  document.getElementById('repLeaveCaps').innerHTML = LEAVE_TYPES.map(function(t){
    var used = usedYear[t] || 0;
    var cap = caps[t];
    var label;
    if(!cap){
      label = 'مصرف‌شده (بدون سقف)';
      return rstat(fmtLeaveDays(used)+' روز', t+' — '+label);
    }
    var rem = Math.max(0, cap - used);
    label = 'مانده از '+cap;
    return rstat(fmtLeaveDays(rem)+' روز', t+' — '+label+' (مصرف '+fmtLeaveDays(used)+')');
  }).join('');

  var listEl = document.getElementById('repFilterList');
  if(repFilter === 'all'){
    listEl.innerHTML = '<div class="empty" style="padding:12px 0;">برای دیدن لیست، یکی از فیلترها را انتخاب کنید</div>';
  } else if(!matched.length){
    listEl.innerHTML = '<div class="empty" style="padding:12px 0;">روزی با این فیلتر نیست</div>';
  } else {
    listEl.innerHTML = matched.map(function(item){
      var badge = typeBadgeLabel(item.entry, item.date);
      var detail = entryDetailText(item.entry) || '—';
      return '<div class="day-row" data-key="'+item.key+'">'+
        '<div class="day-num">'+item.d+'</div>'+
        '<div class="day-info"><div class="day-wd">'+weekdayShortFmt.format(item.date)+'</div>'+
        '<div class="day-detail">'+detail+'</div></div>'+
        '<span class="badge '+badge.cls+'">'+badge.text+'</span></div>';
    }).join('');
    Array.prototype.forEach.call(listEl.querySelectorAll('.day-row'), function(row){
      row.addEventListener('click', function(){ openSheet(row.getAttribute('data-key')); });
    });
  }

  document.getElementById('btnMizitoBulk').style.display = mizitoConfigured() ? 'flex' : 'none';
}
Array.prototype.forEach.call(document.querySelectorAll('#segRepFilter button'), function(b){
  b.addEventListener('click', function(){
    repFilter = b.getAttribute('data-v') || 'all';
    renderReport();
  });
});
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

/* ---------------- Open-session checkout reminder ---------------- */
function cancelOpenSessionReminder(){
  var plugins = getCapacitorPlugins();
  if(plugins && plugins.LocalNotifications){
    return plugins.LocalNotifications.cancel({ notifications: [{ id: REMINDER_NOTIF_ID }] }).catch(function(){});
  }
  return Promise.resolve();
}
function ensureReminderPermission(){
  var plugins = getCapacitorPlugins();
  if(!plugins || !plugins.LocalNotifications) return Promise.resolve(false);
  var LN = plugins.LocalNotifications;
  return LN.checkPermissions().then(function(p){
    if(p && p.display === 'granted') return true;
    return LN.requestPermissions().then(function(p2){
      return !!(p2 && p2.display === 'granted');
    });
  }).catch(function(){ return false; });
}
function syncOpenSessionReminder(){
  var entry = getEntry(todayKey());
  var open = openSession(entry);
  var rem = DATA.settings.reminder || DEFAULT_DATA.settings.reminder;
  if(!rem.enabled || !open){
    return cancelOpenSessionReminder();
  }
  // If already past the threshold, fire soon (1 min); else from check-in + afterMinutes
  var now = new Date();
  var parts = String(open.checkIn || '0:0').split(':').map(Number);
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parts[0]||0, parts[1]||0, 0, 0);
  var due = new Date(start.getTime() + (rem.afterMinutes || 90) * 60 * 1000);
  var plugins = getCapacitorPlugins();
  if(!plugins || !plugins.LocalNotifications) return Promise.resolve();
  return ensureReminderPermission().then(function(ok){
    if(!ok) return;
    var at = due.getTime() <= Date.now() ? new Date(Date.now() + 60 * 1000) : due;
    return cancelOpenSessionReminder().then(function(){
      return plugins.LocalNotifications.schedule({
        notifications: [{
          id: REMINDER_NOTIF_ID,
          title: 'خروج ثبت نشده',
          body: 'از ساعت '+open.checkIn+' جلسه باز است — خروج را ثبت کنید',
          schedule: { at: at, allowWhileIdle: true },
          extra: { kind: 'open_session' }
        }]
      });
    });
  }).catch(function(){});
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
function buildReportWorkbook(jy, jm, filter){
  filter = filter || 'all';
  var info = jalaliMonthInfo(jy, jm);
  var agg = aggregateMonth(jy, jm);
  var name = DATA.settings.employeeName || '—';
  var genDate = jalaliLabel(new Date());
  var usedYear = aggregateYearLeave(jy);
  var caps = DATA.settings.leaveCaps || {};

  var HEAD_FILL = "1F2A37", HEAD_FONT = "FFFFFF";
  var TITLE_FILL = "AE3A2E";
  var rows = [];

  rows.push(["گزارش تردد پرسنل"]);
  rows.push(["نام: "+name, "", "ماه: "+info.name+" "+jy, "", "تاریخ تهیه: "+genDate]);
  if(filter !== 'all'){
    rows.push(["فیلتر: "+filterLabel(filter)]);
  } else {
    rows.push([]);
  }
  var headers = ["ردیف","تاریخ","روز هفته","وضعیت","ساعت ورود","ساعت خروج","مدت کارکرد (ساعت)","نسبت به سقف روزانه","توضیحات"];
  rows.push(headers);

  var rowNo = 0;
  var fWorked = 0, fLeaveDays = 0, fLeaveHours = 0, fHoliday = 0, fOtDays = 0;

  for(var d=1; d<=info.days; d++){
    var date = new Date(info.start.getTime());
    date.setDate(date.getDate()+(d-1));
    var key = dateKeyOf(date);
    var entry = getEntry(key);
    var wd = isWeeklyWorkDay(date);

    if(filter !== 'all'){
      if(!entryMatchesFilter(entry, date, filter)) continue;
      if(!entry || !entryHasContent(entry)) continue;
    }

    var statusText = "تعطیل هفتگی";
    var cin = "", cout = "", worked = "", diffText = "";
    var note = entry && entry.note ? entry.note : "";

    if(entry && entryHasContent(entry)){
      statusText = entryStatusText(entry) || "ثبت‌شده";
      if(entry.holiday){
        diffText = "0.00";
        fHoliday++;
      } else {
        var times = entryTimesJoined(entry);
        cin = times.cin;
        cout = times.cout;
        var mins = entryWorkedMinutes(entry);
        fWorked += mins;
        var leave = entryLeave(entry);
        if(mins > DATA.settings.stdHours*60) fOtDays++;
        if(mins > 0 || entrySessions(entry).length){
          worked = (mins/60).toFixed(2);
          var diff = mins - DATA.settings.stdHours*60;
          diffText = (diff>=0?"+":"")+(diff/60).toFixed(2);
        } else if(leave && leave.kind === 'hours'){
          worked = (mins/60).toFixed(2);
          diffText = (-(leave.leaveMinutes||0)/60).toFixed(2);
        } else if(leave && leave.kind === 'full'){
          worked = "";
          diffText = "0.00";
        }
        if(leave){
          if(leave.kind === 'full') fLeaveDays++;
          else fLeaveHours += (leave.leaveMinutes||0);
          var leaveNote = leave.kind === 'full'
            ? ('مرخصی روزانه ('+(leave.leaveType||'استحقاقی')+')')
            : (((leave.leaveMinutes||0)/60)+' ساعت مرخصی'+(leave.leaveType?(' — '+leave.leaveType):''));
          note = note ? (leaveNote+' — '+note) : leaveNote;
        }
      }
    } else if(wd){
      statusText = "بدون ثبت";
    }

    rowNo++;
    rows.push([rowNo, jalaliLabel(date), weekdayFmt.format(date), statusText, cin, cout, worked, diffText, note]);
  }

  var sumRowStart = rows.length + 1;
  rows.push([]);
  rows.push(["جمع‌بندی"+(filter==='all'?' ماه':' فیلتر')]);
  if(filter === 'all'){
    rows.push(["جمع ساعت کارکرد", (agg.workedMinutes/60).toFixed(2)]);
    rows.push(["اضافه‌کاری / کسری (ساعت)", (agg.overtimeMinutes/60).toFixed(2)]);
    rows.push(["تعداد روز مرخصی روزانه", agg.leaveDays]);
    rows.push(["جمع ساعات مرخصی ساعتی", (agg.leaveHoursTotal/60).toFixed(2)]);
    rows.push(["تعداد روزهای تعطیل رسمی", agg.holidayDays]);
    rows.push(["تعداد روزهای بدون ثبت (کاری)", agg.missingDays]);
    Object.keys(agg.leaveByType).forEach(function(t){
      rows.push(["  از این میان، مرخصی "+t, agg.leaveByType[t]]);
    });
  } else {
    rows.push(["تعداد روزهای فیلتر", rowNo]);
    rows.push(["جمع ساعت کارکرد (فیلتر)", (fWorked/60).toFixed(2)]);
    rows.push(["تعداد روز مرخصی روزانه", fLeaveDays]);
    rows.push(["جمع ساعات مرخصی ساعتی", (fLeaveHours/60).toFixed(2)]);
    rows.push(["تعداد روز اضافه‌کار", fOtDays]);
    rows.push(["تعداد تعطیل رسمی در فیلتر", fHoliday]);
  }
  rows.push([]);
  rows.push(["مانده مرخصی سال "+jy]);
  LEAVE_TYPES.forEach(function(t){
    var used = usedYear[t] || 0;
    var cap = caps[t];
    if(!cap){
      rows.push(["مرخصی "+t, "مصرف "+fmtLeaveDays(used)+" روز (بدون سقف)"]);
    } else {
      rows.push(["مرخصی "+t, "مانده "+fmtLeaveDays(Math.max(0, cap-used))+" از "+cap+" (مصرف "+fmtLeaveDays(used)+")"]);
    }
  });

  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:5},{wch:12},{wch:10},{wch:28},{wch:28},{wch:28},{wch:14},{wch:16},{wch:30}];
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
    var isLeave = st.indexOf("مرخصی") !== -1;
    var isHol = st.indexOf("تعطیل رسمی") === 0;
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

  var fname = "تردد-"+(name!=='—'?name.replace(/\s+/g,'_')+'-':'')+jy+'-'+pad2(jm);
  if(filter !== 'all') fname += '-'+filter;
  fname += ".xlsx";
  return { wb: wb, fname: fname };
}

document.getElementById('btnExport').addEventListener('click', function(){
  if(typeof XLSX === 'undefined'){ showToast('کتابخانه اکسل بارگذاری نشد'); return; }
  var btn = document.getElementById('btnExport');
  btn.disabled = true;
  var built = buildReportWorkbook(repView.y, repView.m, repFilter);
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
function countEntries(entries){
  var n = 0;
  Object.keys(entries || {}).forEach(function(k){
    if(entryHasContent(normalizeEntry(entries[k]))) n++;
  });
  return n;
}
function buildBackupPayload(){
  var copy = JSON.parse(JSON.stringify(DATA));
  if(copy.settings && copy.settings.mizito){
    copy.settings.mizito.token = "";
    copy.settings.mizito.username = "";
    copy.settings.mizito.passHash = "";
  }
  return {
    app: 'tardod',
    schema: 2,
    exportedAt: new Date().toISOString(),
    entryCount: countEntries(copy.entries),
    data: copy
  };
}
function exportBackup(opts){
  opts = opts || {};
  var payload = buildBackupPayload();
  var json = JSON.stringify(payload, null, 2);
  var fname = 'tarad-backup-'+todayKey()+'-'+payload.entryCount+'days.json';
  var noteEl = document.getElementById(opts.noteId || 'backupSafeNote');
  if(noteEl){
    noteEl.className = 'mz-note';
    noteEl.textContent = 'در حال ساخت پشتیبان ('+payload.entryCount+' روز)...';
  }
  return nativeSaveAndShare(fname, json, true).then(function(handledNatively){
    if(!handledNatively){
      var blob = new Blob([json], {type:'application/json'});
      browserDownloadFallback(fname, blob);
    }
    var msg = 'پشتیبان آماده شد ('+payload.entryCount+' روز). فایل را در تلگرام Saved یا Files نگه دارید.';
    showToast(msg);
    if(noteEl){
      noteEl.className = 'mz-note ok';
      noteEl.textContent = msg + (opts.safeHint
        ? ' حالا می‌توانید APK جدید را نصب کنید؛ اگر فیل شد اپ را پاک کنید و بعد بازیابی کنید.'
        : '');
    }
    return true;
  });
}
function normalizeRestoredData(d){
  if(!d || typeof d !== 'object') throw new Error('bad file');
  // support both {data:{settings,entries}} (new) and {settings,entries} (old)
  if(d.data && d.data.settings && d.data.entries) d = d.data;
  if(!d.entries || !d.settings) throw new Error('bad file');
  if(typeof d.settings.stdHours !== 'number') d.settings.stdHours = 8;
  if(!Array.isArray(d.settings.workDays)) d.settings.workDays = [6,0,1,2,3];
  if(!d.settings.leaveCaps || typeof d.settings.leaveCaps !== 'object'){
    d.settings.leaveCaps = JSON.parse(JSON.stringify(DEFAULT_DATA.settings.leaveCaps));
  }
  LEAVE_TYPES.forEach(function(t){
    var v = d.settings.leaveCaps[t];
    d.settings.leaveCaps[t] = (typeof v === 'number' && v >= 0) ? v : (DEFAULT_DATA.settings.leaveCaps[t] || 0);
  });
  if(!d.settings.reminder || typeof d.settings.reminder !== 'object'){
    d.settings.reminder = JSON.parse(JSON.stringify(DEFAULT_DATA.settings.reminder));
  }
  if(typeof d.settings.reminder.enabled !== 'boolean') d.settings.reminder.enabled = true;
  if(typeof d.settings.reminder.afterMinutes !== 'number' || d.settings.reminder.afterMinutes < 15){
    d.settings.reminder.afterMinutes = 90;
  }
  if(!d.settings.mizito) d.settings.mizito = { token:"", project:"", board:"", assignee:"", username:"", passHash:"" };
  ["token","project","board","assignee","username","passHash"].forEach(function(k){
    if(typeof d.settings.mizito[k] !== 'string') d.settings.mizito[k] = '';
  });
  Object.keys(d.entries).forEach(function(k){ d.entries[k] = normalizeEntry(d.entries[k]); });
  return d;
}
document.getElementById('btnBackup').addEventListener('click', function(){
  exportBackup({ noteId: 'backupSafeNote' });
});
document.getElementById('btnBackupSafe').addEventListener('click', function(){
  var n = countEntries(DATA.entries);
  if(!confirm('پشتیبان از '+n+' روز ساخته و منوی اشتراک باز می‌شود.\n\nفایل را حتماً جایی بیرون از اپ ذخیره کنید (تلگرام Saved / فایل‌ها).\nبعد می‌توانید APK را آپدیت کنید یا اپ را پاک کنید.')) return;
  exportBackup({ noteId: 'backupSafeNote', safeHint: true });
});
document.getElementById('btnRestore').addEventListener('click', function(){
  document.getElementById('restoreFile').click();
});
document.getElementById('restoreFile').addEventListener('change', function(e){
  var file = e.target.files[0];
  if(!file) return;
  var note = document.getElementById('restoreNote');
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var parsed = JSON.parse(reader.result);
      var d = normalizeRestoredData(parsed);
      var n = countEntries(d.entries);
      if(!confirm('بازیابی '+n+' روز از فایل پشتیبان؟\nدادهٔ فعلی اپ با این فایل جایگزین می‌شود.')){
        if(note){ note.className = 'mz-note'; note.textContent = 'بازیابی لغو شد'; }
        return;
      }
      var keep = DATA.settings.mizito || {};
      d.settings.mizito = d.settings.mizito || {};
      ["project","board","assignee"].forEach(function(k){
        if(!d.settings.mizito[k]) d.settings.mizito[k] = keep[k] || "";
      });
      // keep live login secrets from current device if backup stripped them
      if(!d.settings.mizito.token) d.settings.mizito.token = keep.token || "";
      if(!d.settings.mizito.username) d.settings.mizito.username = keep.username || "";
      if(!d.settings.mizito.passHash) d.settings.mizito.passHash = keep.passHash || "";
      DATA = d;
      saveData();
      syncOpenSessionReminder();
      showToast('بازیابی انجام شد — '+n+' روز');
      if(note){ note.className = 'mz-note ok'; note.textContent = 'بازیابی موفق: '+n+' روز برگردانده شد ✓'; }
      refreshAll();
    }catch(err){
      showToast('فایل پشتیبان نامعتبر است');
      if(note){ note.className = 'mz-note err'; note.textContent = 'فایل پشتیبان نامعتبر است'; }
    }
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

/* ---------------- Init ---------------- */
function refreshAll(){
  renderTopDate();
  renderToday();
  renderCalendar();
  renderReport();
  renderSettings();
}
function wireAppResumeReminder(){
  var plugins = getCapacitorPlugins();
  if(plugins && plugins.App && plugins.App.addListener){
    plugins.App.addListener('appStateChange', function(state){
      if(state && state.isActive) syncOpenSessionReminder();
    });
  }
}
setInterval(renderTopDate, 60000);
refreshAll();
syncOpenSessionReminder();
wireAppResumeReminder();

// expose a couple of internals for debugging via the app's own devtools, harmless in production
window.__tardod = {
  DATA: DATA, aggregateMonth: aggregateMonth, jalaliPartsOf: jalaliPartsOf, jalaliMonthInfo: jalaliMonthInfo,
  calView: calView, repView: repView, buildReportWorkbook: buildReportWorkbook,
  normalizeEntry: normalizeEntry, buildMizitoNotes: buildMizitoNotes, entryWorkedMinutes: entryWorkedMinutes,
  entryStatusText: entryStatusText, validateSessions: validateSessions,
  aggregateYearLeave: aggregateYearLeave, entryMatchesFilter: entryMatchesFilter,
  syncOpenSessionReminder: syncOpenSessionReminder
};

})();
