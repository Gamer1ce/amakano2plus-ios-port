// CatSystem numeric expressions. Source text is parsed; no eval or Function.
export function expression(source, state, macros = {}) {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?)|([#$](?:\d+|[A-Za-z_]\w*))|("(?:[^"\\]|\\.)*")|(==|!=|<=|>=|&&|\|\||<<|>>|[()+\-*/%<>&|^!~@]))/gy;
  let at = 0;
  while (at < source.length) {
    pattern.lastIndex = at;
    const match = pattern.exec(source);
    if (!match) { if (!source.slice(at).trim()) break; throw new Error(`Unsupported expression: ${source}`); }
    tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4]);
    at = pattern.lastIndex;
  }
  let index = 0;
  const levels = {"||":1,"&&":2,"|":3,"^":4,"&":5,"==":6,"!=":6,"<":7,">":7,"<=":7,">=":7,"<<":8,">>":8,"+":9,"-":9,"*":10,"/":10,"%":10};
  const operations = {
    "||":(a,b)=>+(!!a||!!b),"&&":(a,b)=>+(!!a&&!!b),"|":(a,b)=>a|b,"^":(a,b)=>a^b,"&":(a,b)=>a&b,
    "==":(a,b)=>+(a===b),"!=":(a,b)=>+(a!==b),"<":(a,b)=>+(a<b),">":(a,b)=>+(a>b),"<=":(a,b)=>+(a<=b),">=":(a,b)=>+(a>=b),
    "<<":(a,b)=>a<<b,">>":(a,b)=>a>>b,"+":(a,b)=>a+b,"-":(a,b)=>a-b,"*":(a,b)=>a*b,
    "/":(a,b)=>{if(!b)throw new Error("Division by zero");return Math.trunc(a/b)},"%":(a,b)=>{if(!b)throw new Error("Division by zero");return a%b}
  };
  function parse(min=0) {
    const token=tokens[index++];
    let value;
    if (token === "(") { value=parse(); if(tokens[index++]!==")")throw new Error("Unclosed expression"); }
    else if (["!","~","-","+"].includes(token)) { const a=parse(11);value=token==="!"?+!a:token==="~"?~a:token==="-"?-a:a; }
    else if (token === "@") value=0;
    else if (token?.startsWith('"')) value=JSON.parse(token);
    else if (token?.match(/^\$str\d+$/)) value=state.strings?.[token.slice(4)]??'';
    else if (token?.match(/^[#$]/)) { const name=token.slice(1); const id=/^\d+$/.test(name)?name:macros[name];if(id===undefined)throw new Error(`Unknown variable ${token}`);value=Number(state.numbers[id]??0); }
    else if (token?.match(/^\d/)) value=Number(token);
    else throw new Error(`Expected expression in ${source}`);
    while(index<tokens.length && (levels[tokens[index]]??-1)>=min) {
      const op=tokens[index++]; const right=parse(levels[op]+1); value=operations[op](value,right);
    }
    return value;
  }
  const result=parse();
  if(index!==tokens.length || typeof result!=='number' || !Number.isFinite(result)) throw new Error(`Invalid expression: ${source}`);
  return result;
}

export function assign(source,state,macros={}) {
  source=source.trim();
  if(source.startsWith("(")&&source.endsWith(")"))source=source.slice(1,-1).trim();
  const match=/^[#$](\d+|[A-Za-z_]\w*)\s*(=|\+=|-=|\*=|\/=)\s*(.+)$/.exec(source);
  if(!match)throw new Error(`Unsupported assignment: ${source}`);
  const id=/^\d+$/.test(match[1])?match[1]:macros[match[1]];
  if(id===undefined)throw new Error(`Unknown assignment variable ${match[1]}`);
  const value=expression(match[3],state,macros),prev=state.numbers[id]??0;
  state.numbers[id]=match[2]==="="?value:expression(`${prev}${match[2][0]}(${value})`,state,macros);
}

export function splitIf(source) {
  const start=source.indexOf("(");
  if(start<0)throw new Error(`Invalid if: ${source}`);
  let depth=1,end=start+1;
  for(;end<source.length&&depth;end++){if(source[end]==="(")depth++;if(source[end]===")")depth--;}
  if(depth)throw new Error(`Unclosed if: ${source}`);
  return [source.slice(start+1,end-1),source.slice(end).trim()];
}

export function expand(source,state) {
  return source.replace(/\$str(\d+)/g,(_,id)=>state.strings[id]??"");
}

// Preserve parenthesized arithmetic as one argument instead of treating its
// spaces as command separators. This is also used for quoted string arguments.
export function argumentsOf(source) {
  const result=[];let token='',depth=0,quoted=false;
  for(let i=0;i<source.length;i++) {
    const char=source[i];
    if(char==='"'&&source[i-1]!=='\\')quoted=!quoted;
    if(!quoted){if(char==='(')depth++;if(char===')')depth--;}
    if(/\s/.test(char)&&!depth&&!quoted){if(token){result.push(token);token='';}}
    else token+=char;
    if(depth<0)throw new Error(`Unbalanced argument: ${source}`);
  }
  if(depth||quoted)throw new Error(`Unclosed argument: ${source}`);
  if(token)result.push(token);return result;
}

export function numericArgument(source,state,current=0) {
  if(source===undefined||source==='')return current;
  source=String(source).replace(/%$/,'');
  // @ means retain the existing bank value, including relative coordinates.
  return expression(source.replace(/@/g,String(current)),state);
}

export function messageText(source,state) {
  return expand(source,state).replace(/\\n/g,'\n').replace(/\\@/g,'');
}
