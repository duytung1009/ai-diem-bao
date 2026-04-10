function repairUnescapedQuotes(text) {
  const out = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (ch !== '"') { out.push(ch); i++; continue; }
    out.push('"');
    i++;
    while (i < len) {
      const c = text[i];
      if (c === '\') {
        out.push(c); i++;
        if (i < len) { out.push(text[i]); i++; }
        continue;
      }
      if (c === '"') {
        let j = i + 1;
        while (j < len && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')) j++;
        const next = text[j] ?? '';
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === '') {
          out.push('"'); i++; break;
        } else {
          out.push('\\"'); i++; continue;
        }
      }
      if (c === '\n') { out.push('\n'); i++; continue; }
      if (c === '\r') { out.push('\r'); i++; continue; }
      out.push(c); i++;
    }
  }
  return out.join('');
}

// Case 1: raw newlines inside string values (the reported bug)
const rawLLM = '{"summary": "paragraph1\n\nparagraph2", "opinions": [], "conclusion": "end"}';
console.log('=== Case 1: raw newlines in string value ===');
try { JSON.parse(rawLLM); console.log('initial parse: OK'); } catch(e) { console.log('initial parse: FAIL', e.message); }
const repaired1 = repairUnescapedQuotes(rawLLM);
try { const r = JSON.parse(repaired1); console.log('after repair: OK, summary =', JSON.stringify(r.summary)); } catch(e) { console.log('after repair: FAIL', e.message); }

// Case 2: unescaped inner quotes
const unescapedQBad = '{"summary": "muc dich "cam" tai san", "opinions": [], "conclusion": "ok"}';
console.log('\n=== Case 2: unescaped inner quotes ===');
try { JSON.parse(unescapedQBad); console.log('initial parse: OK'); } catch(e) { console.log('initial parse: FAIL', e.message); }
const repaired2 = repairUnescapedQuotes(unescapedQBad);
try { const r = JSON.parse(repaired2); console.log('after repair: OK, summary =', JSON.stringify(r.summary)); } catch(e) { console.log('after repair: FAIL', e.message); }

// Case 3: structural newlines + raw newlines in values
const multiline = '{\n  "summary": "line1\n\nline2",\n  "opinions": [],\n  "conclusion": "end"\n}';
console.log('\n=== Case 3: structural newlines + raw newlines in value ===');
try { JSON.parse(multiline); console.log('initial parse: OK'); } catch(e) { console.log('initial parse: FAIL', e.message); }
const repaired3 = repairUnescapedQuotes(multiline);
try { const r = JSON.parse(repaired3); console.log('after repair: OK, summary =', JSON.stringify(r.summary)); } catch(e) { console.log('after repair: FAIL', e.message); }

// Case 4: valid JSON with already-escaped newlines in values — must not corrupt
const valid = JSON.stringify({summary: 'para1\n\npara2', opinions: [], conclusion: 'end'}, null, 2);
console.log('\n=== Case 4: valid JSON (pre-escaped) should not be corrupted ===');
const repaired4 = repairUnescapedQuotes(valid);
try { const r = JSON.parse(repaired4); console.log('after repair: OK, summary =', JSON.stringify(r.summary)); } catch(e) { console.log('after repair: FAIL', e.message); }

// Case 5: both bugs at once (raw newlines + unescaped quote)
const both = '{"summary": "para1\n\npara2 with "unescaped" here", "opinions": [], "conclusion": "end"}';
console.log('\n=== Case 5: both raw newlines AND unescaped quotes ===');
try { JSON.parse(both); console.log('initial parse: OK'); } catch(e) { console.log('initial parse: FAIL', e.message); }
const repaired5 = repairUnescapedQuotes(both);
try { const r = JSON.parse(repaired5); console.log('after repair: OK, summary =', JSON.stringify(r.summary)); } catch(e) { console.log('after repair: FAIL', e.message); }
