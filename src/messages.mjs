import {fail,groupId,imageFile} from './group-actions.mjs';

export function messagePayload(body) {
  if(!groupId(body?.chatId))throw fail('A group chatId ending in @g.us is required');
  if(!['text','pdf','image'].includes(body.type))throw fail('type must be text, pdf or image');
  if(body.type==='text'){
    if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000)throw fail('text must contain 1–4000 characters');
    return {session:'default',chatId:body.chatId,text:body.text};
  }
  if(typeof body.data!=='string'||body.data.length>7_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)||Buffer.from(body.data,'base64').length>5*1024*1024)throw fail('Attach a file under 5 MB.');
  if(body.caption!==undefined&&(typeof body.caption!=='string'||body.caption.length>1000))throw fail('Caption must be at most 1,000 characters.');
  let file;
  if(body.type==='image')file=imageFile(body);
  else {
    if(!Buffer.from(body.data,'base64').subarray(0,5).equals(Buffer.from('%PDF-')))throw fail('A base64 PDF under 5 MB is required');
    if(typeof body.filename!=='string'||!/^[\w .-]{1,120}\.pdf$/i.test(body.filename))throw fail('A valid PDF filename is required');
    file={mimetype:'application/pdf',filename:body.filename,data:body.data};
  }
  return {session:'default',chatId:body.chatId,file,...(body.caption?{caption:body.caption}:{})};
}
