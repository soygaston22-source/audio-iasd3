const fs = require('fs');
const file = 'src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add states
if (!content.includes('const [instagramPostUrl, setInstagramPostUrl]')) {
  content = content.replace(
    'const [youtubeLiveUrl, setYoutubeLiveUrl] = useState<string>("");',
    'const [youtubeLiveUrl, setYoutubeLiveUrl] = useState<string>("");\n  const [instagramPostUrl, setInstagramPostUrl] = useState<string>("");\n  const [instagramProfileUrl, setInstagramProfileUrl] = useState<string>("");'
  );
}

// 2. Add to onSnapshot
if (!content.includes('setInstagramPostUrl(data.instagramPostUrl)')) {
  content = content.replace(
    'if (data.youtubeLiveUrl !== undefined) setYoutubeLiveUrl(data.youtubeLiveUrl);',
    'if (data.youtubeLiveUrl !== undefined) setYoutubeLiveUrl(data.youtubeLiveUrl);\n        if (data.instagramPostUrl !== undefined) setInstagramPostUrl(data.instagramPostUrl);\n        if (data.instagramProfileUrl !== undefined) setInstagramProfileUrl(data.instagramProfileUrl);'
  );
}

// 3. Add to UserView props
content = content.replace(
  'announcements: Announcement[],',
  'announcements: Announcement[],\n  instagramPostUrl: string,\n  instagramProfileUrl: string,'
);

content = content.replace(
  'youtubeLiveUrl: string,',
  'youtubeLiveUrl: string,\n  instagramPostUrl: string,\n  instagramProfileUrl: string,'
);

content = content.replace(
  'onUpdateYoutubeLive?: (url: string) => void',
  'onUpdateYoutubeLive?: (url: string) => void,\n  onUpdateInstagramInfo?: (postUrl: string, profileUrl: string) => void'
);

content = content.replace(
  'function UserView({ currentDate, schedule, userName, status, notifications, pendingSwaps, approvedSwaps, specialShifts, seedOffset, announcements, aiSchedules,',
  'function UserView({ currentDate, schedule, userName, status, notifications, pendingSwaps, approvedSwaps, specialShifts, seedOffset, announcements, aiSchedules, instagramPostUrl, instagramProfileUrl,'
);

content = content.replace(
  'function AdminView({ schedule, statuses, activityLog, resetRequests, futureRequests, specialShifts, pendingSwaps, approvedSwaps, seedOffset, announcements, aiSchedules, onApproveSwap, onRejectSwap, onRandomReassign, onAddSpecialShift, onApproveReset, onAcceptFutureRequest, onResetPassword, onDismissFutureRequest, onRejectFutureRequest, onDeleteAnnouncement, youtubeLiveUrl, onUpdateYoutubeLive',
  'function AdminView({ schedule, statuses, activityLog, resetRequests, futureRequests, specialShifts, pendingSwaps, approvedSwaps, seedOffset, announcements, aiSchedules, onApproveSwap, onRejectSwap, onRandomReassign, onAddSpecialShift, onApproveReset, onAcceptFutureRequest, onResetPassword, onDismissFutureRequest, onRejectFutureRequest, onDeleteAnnouncement, youtubeLiveUrl, onUpdateYoutubeLive, instagramPostUrl, instagramProfileUrl, onUpdateInstagramInfo'
);

// Add to UserView rendering in App
content = content.replace(
  '<UserView \n            aiSchedules={aiSchedules}',
  '<UserView \n            aiSchedules={aiSchedules}\n            instagramPostUrl={instagramPostUrl}\n            instagramProfileUrl={instagramProfileUrl}'
);

// Add to AdminView rendering in App
content = content.replace(
  'youtubeLiveUrl={youtubeLiveUrl}\n            onUpdateYoutubeLive={handleUpdateYoutubeLive}',
  'youtubeLiveUrl={youtubeLiveUrl}\n            onUpdateYoutubeLive={handleUpdateYoutubeLive}\n            instagramPostUrl={instagramPostUrl}\n            instagramProfileUrl={instagramProfileUrl}\n            onUpdateInstagramInfo={async (post, profile) => {\n              await setDoc(doc(db, "app_state", "global"), { instagramPostUrl: post, instagramProfileUrl: profile }, { merge: true });\n              alert("Información de Instagram actualizada.");\n            }}'
);

// 4. Update AdminView UI
const adminVideoBlock = `<div style={{ marginTop: '1rem', display: 'flex', gap: '10px' }}>
          <input 
            id="youtube-live-input"
            type="text" 
            placeholder="URL del video o vivo (ej: https://youtube.com/watch?v=...)" 
            defaultValue={youtubeLiveUrl}
            className="input" 
            style={{ flex: 1 }}
          />
          <button 
            onClick={() => {
              const el = document.getElementById("youtube-live-input") as HTMLInputElement;
              if (el && onUpdateYoutubeLive) onUpdateYoutubeLive(el.value);
            }}
            className="btn btn-primary"
            style={{ width: 'auto', padding: '0 20px', background: '#ff0000' }}
          >
            Guardar
          </button>
        </div>
      </div>`;

const newAdminVideoBlock = `<div style={{ marginTop: '1rem', display: 'flex', gap: '10px' }}>
          <input 
            id="youtube-live-input"
            type="text" 
            placeholder="URL del video o vivo (ej: https://youtube.com/watch?v=...)" 
            defaultValue={youtubeLiveUrl}
            className="input" 
            style={{ flex: 1 }}
          />
          <button 
            onClick={() => {
              const el = document.getElementById("youtube-live-input") as HTMLInputElement;
              if (el && onUpdateYoutubeLive) onUpdateYoutubeLive(el.value);
            }}
            className="btn btn-primary"
            style={{ width: 'auto', padding: '0 20px', background: '#ff0000' }}
          >
            Guardar
          </button>
        </div>
      </div>

      <div style={{ marginTop: '2rem', padding: '20px', background: 'rgba(225, 48, 108, 0.1)', border: '1px solid rgba(225, 48, 108, 0.3)', borderRadius: '12px' }}>
        <h3 style={{ color: '#e1306c', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          📸 Integración con Instagram
        </h3>
        <p style={{ color: 'var(--glass-text)', marginBottom: '12px', fontSize: '0.9rem' }}>
          Copia el enlace de una Publicación o Reel para incrustarlo, y el enlace de la cuenta (ej. https://instagram.com/tuiglesia) para el botón de Historias.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input 
            id="instagram-post-input"
            type="text" 
            placeholder="URL de la Publicación o Reel" 
            defaultValue={instagramPostUrl}
            className="input" 
          />
          <input 
            id="instagram-profile-input"
            type="text" 
            placeholder="URL del Perfil (para Historias)" 
            defaultValue={instagramProfileUrl}
            className="input" 
          />
          <button 
            onClick={() => {
              const postEl = document.getElementById("instagram-post-input") as HTMLInputElement;
              const profEl = document.getElementById("instagram-profile-input") as HTMLInputElement;
              if (postEl && profEl && onUpdateInstagramInfo) {
                onUpdateInstagramInfo(postEl.value, profEl.value);
              }
            }}
            className="btn btn-primary"
            style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)', border: 'none' }}
          >
            Guardar Configuración de Instagram
          </button>
        </div>
      </div>`;

content = content.replace(adminVideoBlock, newAdminVideoBlock);

// 5. Update UserView UI
// Inside UserView, let's locate the multimedia rendering block.
const userMultimediaOld = `{showYoutubePlayer && (
        <div className="glass-card" style={{ padding: '0', overflow: 'hidden', marginBottom: '2rem' }}>
          <div style={{ padding: '16px', background: 'rgba(255,0,0,0.1)', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ color: '#ff0000', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '10px', height: '10px', background: '#ff0000', borderRadius: '50%', display: 'inline-block', animation: 'pulse 1.5s infinite' }}></span>
              Transmisión en Vivo
            </h3>
            <button onClick={() => setShowYoutubePlayer(false)} style={{ background: 'none', border: 'none', color: 'var(--glass-text)', cursor: 'pointer' }}>✖</button>
          </div>
          <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
            <iframe 
              src={youtubeLiveUrl.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/")} 
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
              allowFullScreen
            ></iframe>
          </div>
        </div>
      )}`;

const getInstaEmbed = `(url: string) => {
    // If it's just a raw link, transform to embed format
    // https://www.instagram.com/p/C_something/?utm_source=ig_web_copy_link -> https://www.instagram.com/p/C_something/embed
    try {
       const u = new URL(url);
       u.search = '';
       let finalUrl = u.toString();
       if (!finalUrl.endsWith('/')) finalUrl += '/';
       finalUrl += 'embed';
       return finalUrl;
    } catch {
       return url;
    }
  }`;

const userMultimediaNew = `{showYoutubePlayer && (
        <div className="glass-card" style={{ padding: '0', overflow: 'hidden', marginBottom: '2rem' }}>
          <div style={{ padding: '16px', background: 'rgba(255,0,0,0.1)', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ color: '#ff0000', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '10px', height: '10px', background: '#ff0000', borderRadius: '50%', display: 'inline-block', animation: 'pulse 1.5s infinite' }}></span>
              Transmisión en Vivo
            </h3>
            <button onClick={() => setShowYoutubePlayer(false)} style={{ background: 'none', border: 'none', color: 'var(--glass-text)', cursor: 'pointer' }}>✖</button>
          </div>
          <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
            <iframe 
              src={youtubeLiveUrl.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/")} 
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
              allowFullScreen
            ></iframe>
          </div>
        </div>
      )}

      {instagramProfileUrl && (
        <div style={{ marginBottom: '1rem' }}>
          <a 
            href={instagramProfileUrl.includes('/stories/') ? instagramProfileUrl : (instagramProfileUrl + (instagramProfileUrl.endsWith('/') ? '' : '/') + 'stories')}
            target="_blank" rel="noopener noreferrer"
            className="btn"
            style={{ display: 'block', textAlign: 'center', background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)', color: 'white', border: 'none', fontWeight: 'bold' }}
          >
            📸 Ver Historias de Hoy en Instagram
          </a>
        </div>
      )}

      {instagramPostUrl && (
        <div className="glass-card" style={{ padding: '0', overflow: 'hidden', marginBottom: '2rem', background: 'white' }}>
          <iframe 
            src={${getInstaEmbed}(instagramPostUrl)} 
            width="100%" 
            height="480" 
            frameBorder="0" 
            scrolling="no" 
            allowTransparency={true}
          ></iframe>
        </div>
      )}`;

content = content.replace(userMultimediaOld, userMultimediaNew);

fs.writeFileSync(file, content);
console.log('Instagram feature patched successfully.');
