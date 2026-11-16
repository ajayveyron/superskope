import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commandCandidates,createInterpreter,validatePlan} from '../src/ai-commands.mjs';
const bot='910000000001@c.us',member='910000000003@c.us';
const group={subject:'Test',participants:[{id:'11111@lid',phoneNumber:bot,admin:'superadmin'},{id:'33333@lid',phoneNumber:member}]};
const context={text:'Please give @910000000003 admin access',group,selfIds:[bot,'11111@lid'],mentions:[member],contacts:[{id:member,name:'Rashi'}]};
const action=(name,targets=[],text=null,adminsOnly=null)=>({action:name,targets,text,adminsOnly});
test('AI plans cannot invent member IDs, target the bot or remove the creator',()=>{
 const candidates=commandCandidates(context);
 const plan=actions=>({intent:'act',message:'',actions});
 assert.deepEqual(validatePlan(plan([action('promote',['p2'])]),candidates).actions,[{action:'promote',participants:[member]}]);
 assert.throws(()=>validatePlan(plan([action('add',['invented-id'])]),candidates),/@mention/);
 assert.throws(()=>validatePlan(plan([action('remove',['p1'])]),candidates),/own membership/);
 assert.throws(()=>validatePlan(plan([action('subject',[],'')]),candidates),/1–100/);
 assert.throws(()=>validatePlan({intent:'clarify',message:'Who?',actions:[action('remove',['p2'])]},candidates),/rephrase/);
});
test('new member targets come only from supplied numbers; complete plans are validated before execution',()=>{
 const candidates=commandCandidates({...context,text:'Add +91 98765 43210 and make them an admin'});
 const plan=actions=>({intent:'act',message:'',actions});
 assert.equal(candidates[2].id,'919876543210@c.us');
 assert.throws(()=>validatePlan(plan([action('description',[],'Start'),action('promote',['p3'])]),candidates),/not in this group/);
 assert.deepEqual(validatePlan(plan([action('add',['p3']),action('promote',['p3'])]),candidates).actions.map(a=>a.action),['add','promote']);
});
test('structured interpretation sends only current-group candidates, validates output and rejects provider failures',async()=>{
 let request;
 const interpret=createInterpreter({key:'test-key',fetchImpl:async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({intent:'act',message:'',actions:[action('promote',['p2'])]})}}],usage:{prompt_tokens:50,completion_tokens:20}});}});
 const result=await interpret({...context,contacts:[...context.contacts,{id:'919999999999@c.us',name:'Unrelated person'}]});
 assert.equal(result.actions[0].participants[0],member);assert.equal(result.usage.inputTokens,50);assert.equal(request.body.response_format.type,'json_schema');assert.equal(request.options.redirect,'error');assert.doesNotMatch(JSON.stringify(request.body),/Unrelated person|919999999999|test-key/);
 const denied=createInterpreter({key:'test-key',fetchImpl:async()=>new Response('secret provider detail',{status:401})});await assert.rejects(()=>denied(context),/Nothing was changed/);
 const truncated=createInterpreter({key:'test-key',fetchImpl:async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]})});await assert.rejects(()=>truncated(context),/Nothing was changed/);
});
