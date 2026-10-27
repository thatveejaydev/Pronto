const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const nodes={},events={},sent=[],storage={};let capture;
for(const id of ['record-preview-shortcut','preview-shortcut-status'])nodes[id]={addEventListener(k,f){this[k]=f;}};
const ctx={BinSearchShortcut:require('../shortcut.js'),document:{getElementById:id=>nodes[id]},localStorage:{getItem:k=>storage[k],setItem:(k,v)=>storage[k]=v},window:{ProntoRecordShortcut:cb=>{capture=cb;return true;},__adobe_cep__:{dispatchEvent:e=>{assert.equal(typeof e,'object');sent.push(e);},addEventListener:(k,f)=>events[k]=f}}};
function load(){vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../preview-settings.js'),'utf8'),ctx);}
load();const b=nodes['record-preview-shortcut'];assert.equal(b.textContent,'Ctrl+Space');
b.click();assert.equal(b.disabled,true);capture({label:'Ctrl+W'});assert.equal(b.disabled,false);assert.equal(storage['pronto.previewShortcut.v1'],'Ctrl+W');assert.equal(sent.at(-1).data,'Ctrl+W');
b.click();capture(null);assert.equal(b.textContent,'Ctrl+W');
storage['binsearch.shortcut.v1']=JSON.stringify({enabled:true,value:'Alt+Space'});b.click();capture({label:'Alt+Space'});assert.equal(b.textContent,'Ctrl+W');
b.contextmenu({preventDefault(){}});assert.equal(sent.at(-1).data,'disabled');load();assert.equal(b.textContent,'disabled');
events['local.binsearch.getPreviewShortcut']();assert.equal(sent.at(-1).data,'disabled');
console.log('PASS compact preview capture, autosave, cancellation, conflicts, disabling and reload');
