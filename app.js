import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';

// Firebase-Daten aus der Firebase Console hier eintragen. Bis dahin läuft die Vorschau lokal.
const firebaseConfig = {
  apiKey: 'DEIN_API_KEY', authDomain: 'DEIN_PROJEKT.firebaseapp.com',
  projectId: 'DEIN_PROJEKT', storageBucket: 'DEIN_PROJEKT.firebasestorage.app',
  messagingSenderId: 'DEINE_SENDER_ID', appId: 'DEINE_APP_ID'
};
const configured = firebaseConfig.apiKey !== 'DEIN_API_KEY';
let auth = null, db = null, user = null, familyId = null;
if (configured) { const app = initializeApp(firebaseConfig); auth = getAuth(app); db = getFirestore(app); }
const $ = id => document.getElementById(id);
const local = { shopping: [], meals: [], events: [], tasks: [] };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show = (id, yes) => $(id).classList.toggle('hidden', !yes);
function switchTab(tab) { document.querySelectorAll('.bottom-nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab)); document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('hidden',p.id!==`tab-${tab}`)); if(tab==='calendar') renderCalendar(); }
document.querySelectorAll('.bottom-nav-item').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.goto)));
$('todayLabel').textContent = new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
$('loginForm').addEventListener('submit', async e => { e.preventDefault(); $('authMessage').textContent=''; if(!configured){$('authMessage').textContent='Firebase ist noch nicht eingerichtet. Bitte zuerst die Konfiguration in app.js ergänzen.';return;} try{await signInWithEmailAndPassword(auth,$('email').value,$('password').value);}catch(err){$('authMessage').textContent=err.code==='auth/invalid-credential'?'E-Mail oder Passwort ist nicht korrekt.':err.message;} });
$('logoutBtn').addEventListener('click',()=>configured?signOut(auth):showLocalLogin());
function showLocalLogin(){user=null;show('appView',false);show('authView',true);show('logoutBtn',false);show('familyBtn',false)}
function enterApp(name='Familien-Dashboard'){show('authView',false);show('appView',true);show('logoutBtn',true);show('familyBtn',true);$('greeting').textContent=name;render();}
if(configured){onAuthStateChanged(auth,async u=>{user=u;if(!u){showLocalLogin();return;} await resolveFamily();enterApp();});}else{ // Interaktive lokale Vorschau ohne Speicherung auf einem Server
  $('loginForm').addEventListener('submit',e=>{e.preventDefault();user={displayName:$('email').value.split('@')[0]||'Familienmitglied',uid:'preview'};enterApp();});
  $('authMessage').textContent='Vorschau-Modus: Zum Testen kannst du dich mit einer beliebigen E-Mail-Adresse anmelden.';
}
async function resolveFamily(){const q=await getDocs(collection(db,'users',user.uid,'memberships'));if(!q.empty){familyId=q.docs[0].data().familyId;return;} $('authMessage').textContent='Dein Konto ist noch keiner Familie zugeordnet. Bitte nutze einen gültigen Einladungscode oder wende dich an die Familien-Administration.';}
function path(type){return collection(db,'families',familyId,type)}
async function load(type){if(!configured||!familyId)return local[type];const snap=await getDocs(query(path(type),orderBy('createdAt','desc')));return snap.docs.map(d=>({id:d.id,...d.data()}));}
async function save(type,data){if(!configured||!familyId){local[type].unshift({id:crypto.randomUUID(),...data});render();return;}await addDoc(path(type),{...data,createdAt:serverTimestamp(),createdBy:user.uid});render();}
async function remove(type,id){if(!configured||!familyId)local[type]=local[type].filter(x=>x.id!==id);else await deleteDoc(doc(db,'families',familyId,type,id));render();}
async function toggleShopping(item){if(!configured||!familyId){item.done=!item.done;render();return;}await updateDoc(doc(db,'families',familyId,'shopping',item.id),{done:!item.done});render();}
$('shoppingForm').addEventListener('submit',async e=>{e.preventDefault();const name=$('shoppingInput').value.trim();if(name){await save('shopping',{name,done:false});$('shoppingInput').value='';}});
$('mealForm').addEventListener('submit',async e=>{e.preventDefault();const name=$('mealInput').value.trim();if(name){await save('meals',{name});$('mealInput').value='';}});
$('taskForm').addEventListener('submit',async e=>{e.preventDefault();const name=$('taskInput').value.trim();if(name){await save('tasks',{name,done:false});$('taskInput').value='';}});
async function toggleTask(item){if(!configured||!familyId){item.done=!item.done;render();return;}await updateDoc(doc(db,'families',familyId,'tasks',item.id),{done:!item.done});render();}
$('eventForm').addEventListener('submit',async e=>{e.preventDefault();const title=$('eventTitle').value.trim(),date=$('eventDate').value;if(title&&date){await save('events',{title,date,scope:$('eventMember').value});e.target.reset();}});
$('inviteForm').addEventListener('submit',e=>{e.preventDefault();$('inviteMessage').textContent='Einladungsverwaltung wird nach dem Einrichten der sicheren Firebase-Einladungsfunktion freigeschaltet. Bitte keine Zugangsdaten per E-Mail versenden.';});
function row(text,meta='',checked=false){return `<li class="item-row ${checked?'done':''}">${checked!==null?`<span class="event-meta">${meta}</span>`:''}<span class="item-text">${esc(text)}${checked===null&&meta?`<span class="event-meta">${esc(meta)}</span>`:''}</span></li>`;}
let calendarCursor=new Date();calendarCursor.setDate(1);
function renderCalendar(){const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),first=new Date(y,m,1),offset=(first.getDay()+6)%7,days=new Date(y,m+1,0).getDate(),today=new Date();$('calendarMonth').textContent=new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric'}).format(calendarCursor);let cells='';for(let i=0;i<offset;i++)cells+='<span class="calendar-day blank"></span>';for(let d=1;d<=days;d++){const key=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,has=(window.currentEvents||[]).some(e=>e.date?.slice(0,10)===key),isToday=y===today.getFullYear()&&m===today.getMonth()&&d===today.getDate();cells+=`<button type="button" class="calendar-day ${has?'has-event':''} ${isToday?'today':''}" data-date="${key}"><span>${d}</span>${has?'<i></i>':''}</button>`;}const total=Math.ceil((offset+days)/7)*7;for(let i=offset+days;i<total;i++)cells+='<span class="calendar-day blank"></span>';$('calendarGrid').innerHTML='<div class="calendar-weekday">Mo</div><div class="calendar-weekday">Di</div><div class="calendar-weekday">Mi</div><div class="calendar-weekday">Do</div><div class="calendar-weekday">Fr</div><div class="calendar-weekday">Sa</div><div class="calendar-weekday">So</div>'+cells;document.querySelectorAll('[data-date]').forEach(b=>b.addEventListener('click',()=>{$('eventDate').value=b.dataset.date+'T12:00';$('eventTitle').focus();}));}
$('prevMonth').addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar();});$('nextMonth').addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar();});
async function render(){const [shopping,meals,events,tasks]=await Promise.all(['shopping','meals','events','tasks'].map(load));window.currentEvents=events;const open=shopping.filter(x=>!x.done);$('shoppingCount').textContent=open.length;$('mealCount').textContent=meals.length;$('eventCount').textContent=events.length;$('shoppingPill').textContent=`${open.length} offen`;const openTasks=tasks.filter(x=>!x.done);$('taskPill').textContent=`${openTasks.length} offen`;$('taskList').innerHTML=tasks.length?tasks.map(x=>`<li class="item-row ${x.done?'done':''}"><input class="check" type="checkbox" ${x.done?'checked':''} data-task-check="${x.id}"><span class="item-text">${esc(x.name)}</span><button class="delete-btn" data-delete="tasks:${x.id}" aria-label="Löschen">×</button></li>`).join(''):'<li class="empty-state">Noch keine Aufgaben. Fügt eure erste Aufgabe hinzu.</li>';renderCalendar();
  $('shoppingList').innerHTML=shopping.length?shopping.map(x=>`<li class="item-row ${x.done?'done':''}"><input class="check" type="checkbox" ${x.done?'checked':''} data-check="${x.id}" aria-label="${esc(x.name)} erledigt"><span class="item-text">${esc(x.name)}</span><button class="delete-btn" data-delete="shopping:${x.id}" aria-label="Löschen">×</button></li>`).join(''):'<li class="empty-state">Die Einkaufsliste ist noch leer.</li>';
  $('mealList').innerHTML=meals.length?meals.map(x=>`<li class="item-row"><span class="item-text">♡ &nbsp;${esc(x.name)}</span><button class="delete-btn" data-delete="meals:${x.id}" aria-label="Löschen">×</button></li>`).join(''):'<li class="empty-state">Noch keine Essenswünsche. Fügt eure Lieblingsgerichte hinzu.</li>';
  const sorted=events.sort((a,b)=>a.date.localeCompare(b.date));$('eventList').innerHTML=sorted.length?sorted.map(x=>`<li class="item-row"><span class="item-text">${esc(x.title)}<span class="event-meta">${new Date(x.date).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'})} · ${x.scope==='child'?'Privater Kindertermin':x.scope==='me'?'Nur ich':'Ganze Familie'}</span></span><button class="delete-btn" data-delete="events:${x.id}" aria-label="Löschen">×</button></li>`).join(''):'<li class="empty-state">Noch keine Termine eingetragen.</li>';
  $('upcomingList').innerHTML=sorted.slice(0,4).map(x=>row(x.title,new Date(x.date).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'}),null)).join('')||'Noch keine Termine eingetragen.';
  $('overviewMeals').innerHTML=meals.slice(0,4).map(x=>row('♡ '+x.name,'',null)).join('')||'Noch keine Wünsche vorhanden.';
  $('memberList').innerHTML=`<div class="member">${esc(user?.displayName||user?.email||'Du')}<small>Angemeldet</small></div>`;
  document.querySelectorAll('[data-check]').forEach(el=>el.addEventListener('change',()=>{const item=shopping.find(x=>x.id===el.dataset.check);if(item)toggleShopping(item);}));document.querySelectorAll('[data-task-check]').forEach(el=>el.addEventListener('change',()=>{const item=tasks.find(x=>x.id===el.dataset.taskCheck);if(item)toggleTask(item);}));document.querySelectorAll('[data-delete]').forEach(el=>el.addEventListener('click',()=>{const [type,id]=el.dataset.delete.split(':');remove(type,id);}));
}
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
