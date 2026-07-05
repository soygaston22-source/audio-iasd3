const fs = require('fs');
const file = 'src/lib/rotation.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/export function getScheduleForDate[\s\S]*?return \{\n    morning,\n    afternoon,\n    weekNo,\n    year,\n    date: scheduleDate\n  \};\n\}/g, '');

fs.writeFileSync(file, content);
console.log('Removed getScheduleForDate');
