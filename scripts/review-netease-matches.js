#!/usr/bin/env node
const fs=require('fs'), api=require('NeteaseCloudMusicApi');
const cookies=JSON.parse(fs.readFileSync(process.env.NETEASE_COOKIE_FILE||'/home/ezra/.hermes/cache/documents/doc_8e7100145464_music.163.com_cookies.json','utf8'));
const cookie=cookies.map(c=>`${c.name}=${c.value}`).join('; ');
const queries={
 '06-do-re-mi':['Do Re Mi children song','Do Re Mi 儿歌','哆来咪 英文儿歌'],
 '09-big-big-world':['Big Big World Emilia','Big Big World original'],
 '10-turkey-in-the-straw':['Turkey in the Straw children','Turkey in the Straw nursery rhyme'],
 '11-little-love':['A Little Love 冯曦妤','A Little Love Fiona Fung'],
 '13-500-miles':['500 Miles away from home','Five Hundred Miles'],
 '23-mothers-day-song':['Skidamarink children','Skidamarink I love you'],
 '26-memory':['Memory Cats musical','Memory Barbra Streisand'],
 '32-i-have-a-dream':['I Have a Dream ABBA'],
 '34-somewhere-over-the-rainbow':['Somewhere Over the Rainbow Judy Garland'],
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const out={};for(const [slug,qs] of Object.entries(queries)){out[slug]=[];for(const q of qs){const r=await api.cloudsearch({keywords:q,type:1,limit:10,cookie});out[slug].push({query:q,candidates:(r.body?.result?.songs||[]).map(s=>({id:s.id,name:s.name,artists:(s.ar||[]).map(a=>a.name),album:s.al?.name,durationMs:s.dt,cover:s.al?.picUrl}))});console.log(slug,q);await sleep(700)}}fs.writeFileSync('.netease-imports/40-classic-english-songs.review-searches.json',JSON.stringify(out,null,2)+'\n')})().catch(e=>{console.error(e);process.exit(1)});
