// --- Chat Client JavaScript ---
// --- Ephemeral Chat Application ---
// --- Everything Was Highlighted for Customization Purposes ---
// --- This is all open source you can modify anything you want ---
// --- Made by windows98unc on Discord ---
// --- Version 1.5.2 (with cat raid command) ---

const loginDiv = document.getElementById('login');
const chatContainer = document.getElementById('chat-container');
const statusEl = document.getElementById('status');
const messagesDiv = document.getElementById('messages');
const usersDiv = document.getElementById('users');
const spamWarning = document.getElementById('spam-warning');
const fileInput = document.getElementById('fileInput');
const loginButton = document.getElementById('join');
const sendButton = document.getElementById('send');
const msgInput = document.getElementById('msg');
const commandBox = document.getElementById('command-box');

let socket, token, user;
let messageCount = 0;
let lastMessageTime = 0;
const messageLimit = 5;
const waitTime = 5000; // 5 seconds

const ownerCommands = ["/clearmessages", "/clearuploads", "/kick", "/shutdown", "/catraid"];

// ---------------- Message Functions ----------------
function addMessage(name, text, file = null, notice = false, isOwner = false) {
  const div = document.createElement('div');
  div.className = notice ? 'notice' : 'msg';

  let nameClass = isOwner ? 'owner-name' : 'name';
  let nameContent = name;

  if(name === 'Jeb_') {
    nameContent = `<span class="rainbow-text">${name}</span>`;
    nameClass = '';
  }

  let content = notice
    ? text
    : `<span class="${nameClass}">${nameContent}</span>: ${text}`;

  if(file) {
    const ext = file.split('.').pop().toLowerCase();
    if(['png','jpg','jpeg','gif','webp'].includes(ext)) content += `<br><img src="${file}">`;
    else if(['mp4','webm','ogg'].includes(ext)) content += `<br><video src="${file}" controls></video>`;
    else content += `<br><a href="${file}" target="_blank">Download file</a>`;
  }

  div.innerHTML = content;
  messagesDiv.appendChild(div);

  // Auto-scroll
  const scrollable = document.querySelector('.chat-scrollable-area');
  setTimeout(() => scrollable.scrollTop = scrollable.scrollHeight, 10);
}

// ---------------- Users List ----------------
function updateUsers(list){
  usersDiv.innerHTML = '';
  list.forEach(u => {
    const div = document.createElement('div');
    if(u.includes("👑")){
      const ownerName = u.replace(" 👑", "");
      div.innerHTML = `${ownerName} <i class="nes-octocat animate"></i>`;
    } else if (u === 'Jeb_') {
      div.innerHTML = `<span class="rainbow-text">${u}</span>`;
    } else {
      div.textContent = u;
    }
    usersDiv.appendChild(div);
  });
}

// ---------------- Cat Raid ----------------
function startCatRaid() {
  const catCount = 50;

  function getRandomCatUrl() {
    const r = Math.floor(Math.random() * 10000);
    const sources = [
      `https://cataas.com/cat?${r}`,
      `https://placekitten.com/${150 + Math.floor(Math.random()*100)}/${150 + Math.floor(Math.random()*100)}`,
      `https://loremflickr.com/200/200/cat?random=${r}`,
      `https://picsum.photos/200/200?random=${r}`
    ];
    return sources[Math.floor(Math.random()*sources.length)];
  }

  for (let i = 0; i < catCount; i++) {
    setTimeout(() => {
      const cat = document.createElement('img');
      cat.src = getRandomCatUrl();
      cat.className = 'cat-raid-image';
      cat.style.left = Math.random() * (window.innerWidth - 150) + 'px';
      cat.style.top = '-150px';
      cat.style.animationDelay = (Math.random() * 2) + 's';
      cat.style.filter = `hue-rotate(${Math.random()*360}deg) brightness(${0.8 + Math.random()*0.4})`;

      cat.onerror = () => { cat.src = `https://placekitten.com/200/200?random=${Math.floor(Math.random()*10000)}`; };

      document.body.appendChild(cat);

      setTimeout(() => {
        if(cat.parentNode) cat.parentNode.removeChild(cat);
      }, 12000);
    }, Math.random() * 2000);
  }
}

// ---------------- Login ----------------
loginButton.onclick = async () => {
  loginButton.disabled = true;
  const pwd = document.getElementById('pwd').value.trim();
  const name = (document.getElementById('name').value.trim()||'anon').slice(0,64);

  let res;
  try{
    res = await fetch('/auth',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password: pwd,name})
    });
  } catch(e){
    statusEl.textContent='Server not reachable';
    loginButton.disabled=false;
    return;
  }

  const data = await res.json();
  if(!data.ok){ statusEl.textContent='Wrong password'; loginButton.disabled=false; return; }

  token = data.token;
  user = data.user;

  const wsUrl = (location.protocol==='https:'?'wss://':'ws://')+location.host+'/?token='+encodeURIComponent(token);
  socket = new WebSocket(wsUrl);

  socket.onopen = ()=>{
    document.body.classList.add('logged-in');
    chatContainer.style.display='flex';
    socket.send(JSON.stringify({type:'join',name:user.displayName}));
  };

  socket.onmessage = e=>{
    const msg = JSON.parse(e.data);

    if(msg.type==='message') addMessage(msg.name,msg.text,msg.file,false,msg.isOwner);
    if(msg.type==='history') msg.messages.forEach(m=>addMessage(m.name,m.text,m.file,false,m.isOwner));
    if(msg.type==='users') updateUsers(msg.list);
    if(msg.type==='cleared') {
      const all = messagesDiv.querySelectorAll('.msg');
      all.forEach(el => el.classList.add('fade-out'));
      setTimeout(()=>messagesDiv.innerHTML='',500);
      addMessage('SYSTEM','--- messages cleared ---',null,true);
    }
    if(msg.type==='filesCleared') {
      const all = messagesDiv.querySelectorAll('.msg');
      all.forEach(el => {
        if(el.querySelector('img') || el.querySelector('video') || el.querySelector('a[href*="/uploads/"]')) el.classList.add('fade-out');
      });
      setTimeout(()=>{
        messagesDiv.innerHTML = '';
        all.forEach(el => {
          if(!el.classList.contains('fade-out')) messagesDiv.appendChild(el);
        });
        addMessage('SYSTEM','--- uploaded files were cleared ---',null,true);
      },500);
    }
    if(msg.type==='error') spamWarning.textContent=msg.msg;

    // Cat raid
    if(msg.type==='message' && msg.text==='/catraid' && msg.isOwner){
      startCatRaid();
      addMessage('SYSTEM','🐱💥 MEGA CAT RAID INCOMING! 💥🐱',null,true);
    }
  };

  socket.onclose = ()=> addMessage('SYSTEM','Disconnected.',null,true);
};

// ---------------- Send Message ----------------
function sendMessage(){
  const text = msgInput.value.trim();
  const now = Date.now();

  if(now-lastMessageTime < 1000){
    messageCount++;
    if(messageCount>messageLimit){
      spamWarning.textContent='Slow down, spam detected!';
      return;
    }
  } else messageCount=1;

  lastMessageTime = now;
  spamWarning.textContent='';

  if(!text && !fileInput.files.length) return;

  socket.send(JSON.stringify({type:'message',text}));
  msgInput.value='';
}

sendButton.onclick = sendMessage;
msgInput.addEventListener('keydown', e => { if(e.key==='Enter') sendMessage(); });

// ---------------- File Upload ----------------
fileInput.addEventListener('change', async ()=>{
  if(!fileInput.files.length) return;
  const file = fileInput.files[0];
  const form = new FormData();
  form.append('file',file);
  form.append('token',token);

  const res = await fetch('/upload',{method:'POST',body:form}).catch(()=>{ spamWarning.textContent='Upload failed'; return; });
  if(!res) return;
  const data = await res.json();
  if(!data.ok) spamWarning.textContent=data.msg;

  fileInput.value='';
});

// ---------------- Owner Command Suggestions ----------------
msgInput.addEventListener('input', () => {
  if(!user?.isOwner) return;

  const val = msgInput.value.trim();
  if(val.startsWith('/')) {
    const query = val.toLowerCase();
    const matches = ownerCommands.filter(cmd => cmd.startsWith(query));

    if(matches.length) {
      commandBox.innerHTML = '';
      matches.forEach(cmd => {
        const btn = document.createElement('button');
        btn.className = 'command-btn';
        btn.textContent = cmd;
        btn.onclick = () => {
          msgInput.value = cmd;
          commandBox.style.display = 'none';
          msgInput.focus();
        };
        commandBox.appendChild(btn);
      });
      commandBox.style.display = 'flex';
    } else commandBox.style.display='none';
  } else commandBox.style.display='none';
});

msgInput.addEventListener('blur', () => {
  setTimeout(()=>commandBox.style.display='none',100);
});
