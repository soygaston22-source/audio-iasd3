const fs = require('fs');
const file = 'src/lib/rotation.ts';
let content = fs.readFileSync(file, 'utf8');

// Replace the FIXED_ROTATION based getScheduleForDate with PRNG based
const oldGetSchedule = /const FIXED_ROTATION[\s\S]*?return \{\n    morning,\n    afternoon,\n    weekNo,\n    year,\n    date: scheduleDate\n  \};\n\}/;

const newGetSchedule = `export function getScheduleForDate(date: Date, approvedSwaps: ApprovedSwap[] = [], seedOffset: number = 0) {
  const { weekNo, year } = getWeekNumber(date);
  
  // Calculate exact date of the Saturday for this week
  const dateObj = new Date(Date.UTC(year, 0, 1));
  dateObj.setUTCDate(dateObj.getUTCDate() + (weekNo - 1) * 7);
  const day = dateObj.getUTCDay();
  const diff = 6 - day;
  dateObj.setUTCDate(dateObj.getUTCDate() + diff);
  const scheduleDate = dateObj.toISOString().split('T')[0];

  const baseSeed = weekNo + (year * 52) + seedOffset;

  // We need to pick 4 people for the weekend. 2 morning, 2 afternoon.
  // Rule: Santiago must be in afternoon.
  
  let available = TEAM.filter(m => m !== "Santiago");
  
  // Sort available pseudo-randomly
  available = available.sort((a, b) => {
    return seededRandom(baseSeed + a.charCodeAt(0)) - 0.5;
  });
  
  let morning = [available[0], available[1]];
  
  // Santiago goes to afternoon, plus one more random person
  let afternoon = ["Santiago", available[2]];
  
  // Optionally shuffle afternoon so Santiago is not always first
  if (seededRandom(baseSeed + 999) > 0.5) {
    afternoon = [available[2], "Santiago"];
  }

  // Apply approved swaps overrides
  approvedSwaps.forEach(swap => {
    if (swap.date1 === scheduleDate) {
      morning = morning.map(m => m === swap.user1 ? swap.user2 : m);
      afternoon = afternoon.map(m => m === swap.user1 ? swap.user2 : m);
    }
    if (swap.date2 === scheduleDate) {
      morning = morning.map(m => m === swap.user2 ? swap.user1 : m);
      afternoon = afternoon.map(m => m === swap.user2 ? swap.user1 : m);
    }
  });

  return {
    morning,
    afternoon,
    weekNo,
    year,
    date: scheduleDate
  };
}`;

content = content.replace(oldGetSchedule, newGetSchedule);

fs.writeFileSync(file, content);
console.log('Restored random logic with Santiago constraint.');
