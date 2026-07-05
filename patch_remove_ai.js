const fs = require('fs');
const file = 'src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// Remove AI Admin UI Block
const aiUIStart = `<div style={{ marginBottom: '2rem' }}>\n            <h3 style={{ color: '#9c27b0', borderBottom: '2px solid #9c27b0', paddingBottom: '8px', marginBottom: '16px' }}>\n              🤖 Organizar Cronograma con IA`;
const aiUIEnd = `</button>\n                </div>\n              )}\n            </div>\n          </div>`;

const startIndex = content.indexOf(aiUIStart);
if (startIndex !== -1) {
  const endIndex = content.indexOf(aiUIEnd, startIndex) + aiUIEnd.length;
  content = content.substring(0, startIndex) + content.substring(endIndex);
}

// Remove AI Admin States
const aiStatesStart = `const [aiAdminPrompt, setAiAdminPrompt] = useState("");`;
const aiStatesEnd = `const handlePublishGrid = async () => {\n    if (!aiAdminResult) return;\n    try {\n      await addDoc(collection(db, "announcements"), {\n        text: "Nuevo cronograma publicado",\n        type: "schedule_grid",\n        gridData: aiAdminResult,\n        timestamp: serverTimestamp(),\n        author: "Administrador (IA)"\n      });\n      alert("Cronograma publicado con éxito en Novedades.");\n      setAiAdminResult(null);\n      setAiAdminPrompt("");\n    } catch (e: any) {\n      alert("Error al publicar cronograma: " + e.message);\n    }\n  };`;

const statesStartIndex = content.indexOf(aiStatesStart);
if (statesStartIndex !== -1) {
  const statesEndIndex = content.indexOf(aiStatesEnd, statesStartIndex) + aiStatesEnd.length;
  content = content.substring(0, statesStartIndex) + content.substring(statesEndIndex);
}

fs.writeFileSync(file, content);
console.log('Removed Admin AI block.');
