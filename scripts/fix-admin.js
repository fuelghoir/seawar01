const fs = require('fs');
let c = fs.readFileSync('app/admin/page.tsx', 'utf8');

c = c.replace(
  /<span>\{isRu \? "[^"]+" : "Min Points"\}<\/span>\s*<input\s*type="number"\s*value=\{dropForm\.minPoints\}/,
  '<span>{isRu ? "Мин. Очки/XP" : "Min Points/XP"}</span>\n                  <input\n                    type="number"\n                    value={dropForm.minPoints}'
);

c = c.replace(
  /<h4 style=\{\{ margin: 0, fontSize: "14px", color: "var\(--accent-bright, #66e9ff\)" \}\}>\s*\{isRu \? "[^"]+" : "Participant Eligibility Rules"\}\s*<\/h4>\s*<\/div>\s*<label>/,
  '<h4 style={{ margin: 0, fontSize: "14px", color: "var(--accent-bright, #66e9ff)" }}>\n                    {isRu ? "Правила отбора участников" : "Participant Eligibility Rules"}\n                  </h4>\n                </div>\n                <label>\n                  <span>{isRu ? "Источник очков" : "Points Source"}</span>\n                  <select value={dropForm.pointsSource} onChange={(e) => setDropForm({ ...dropForm, pointsSource: e.target.value })}>\n                    <option value="all_time">{isRu ? "За все время (Общие поинты)" : "All-time Points"}</option>\n                    <option value="season_current">{isRu ? "Текущий сезон (XP)" : "Current Season XP"}</option>\n                  </select>\n                </label>\n                <label>'
);

fs.writeFileSync('app/admin/page.tsx', c);
