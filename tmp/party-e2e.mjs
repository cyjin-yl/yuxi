import puppeteer from 'puppeteer';
const BASE = 'https://yvxi.pages.dev/collections/';

const INJECT = `
window.__pget = () => {
  const p = window.__yuxiPlayer;
  if (!p) return { ok: false };
  const tr = p.track();
  return {
    ok: true,
    playing: p.playing,
    curr: tr?.id ?? null,
    title: tr?.title ?? null,
    artist: tr?.artist ?? null,
    time: p.mediaTime(),
    queueLen: p.queue.length,
    party: p.partyRoom ? {
      code: p.partyRoom.code,
      members: p.partyRoom.members.length,
      memberNames: p.partyRoom.members.map(m => m.name),
      chatCount: p.partyRoom.chat.length,
      chats: p.partyRoom.chat.slice(-3).map(c => c.name + ':' + c.text),
      queue: p.partyRoom.queue.length,
      mode: p.partyRoom.state.mode,
      track: p.partyRoom.state.track?.id ?? null,
      offset: p.partyRoom.state.offset,
    } : null,
    isHost: p.isPartyHost(),
  };
};
window.__pstart = async (name) => { try { return await window.__yuxiPlayer.startParty(name); } catch (e) { return { err: String(e) }; } };
window.__pjoin = async (code) => { try { return await window.__yuxiPlayer.joinParty(code); } catch (e) { return { err: String(e) }; } };
window.__pchat = async (t) => { try { await window.__yuxiPlayer.sendPartyChat(t); return true; } catch (e) { return { err: String(e) }; } };
window.__pnext = () => window.__yuxiPlayer.next();
window.__psearch = async (q) => { try { const r = await window.__yuxiPlayer.searchNetease(q); return r?.length ?? 0; } catch (e) { return { err: String(e) }; } };
window.__pplaysearch = (i) => window.__yuxiPlayer.playSearchResult(i);
window.__penqueue = (i) => window.__yuxiPlayer.enqueueSearchResult(i);
window.__pload = async (id) => { try { await window.__yuxiPlayer.loadNeteasePlaylist(id); return true; } catch (e) { return { err: String(e) }; } };
`;

function log(...a) { console.log(...a); }

async function setup(page, tag) {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!window.__yuxiPlayer, { timeout: 30000 });
  await page.evaluate(INJECT);
  log(tag, 'pre', await page.evaluate(() => window.__pget()));
  return page;
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const host = await browser.newPage();
const guest = await browser.newPage();
const errors = {};
host.on('pageerror', (e) => (errors.host ||= []).push(e.message));
guest.on('pageerror', (e) => (errors.guest ||= []).push(e.message));

await setup(host, 'host');
await setup(guest, 'guest');

// Host loads the English playlist and lets it start
await host.evaluate(() => window.__pload('18186789918'));
await new Promise((r) => setTimeout(r, 4500));
log('host after load', await host.evaluate(() => window.__pget()));

// Guest searches and plays something else
await guest.evaluate(() => window.__psearch('Hey Jude'));
await new Promise((r) => setTimeout(r, 2000));
const guestSearchCount = await guest.evaluate(() => window.__yuxiPlayer.searchResults.length);
log('guest search count', guestSearchCount);
await guest.evaluate(() => window.__pplaysearch(0));
await new Promise((r) => setTimeout(r, 3500));
log('guest before join', await guest.evaluate(() => window.__pget()));

// Host creates a room while playing
const created = await host.evaluate(() => window.__pstart('一起听'));
log('created room', created?.code, 'state:', JSON.stringify(created?.state));
await new Promise((r) => setTimeout(r, 1500));

// Guest joins
const code = created.code;
const joined = await guest.evaluate((c) => window.__pjoin(c), code);
log('joined', joined?.code, 'state:', JSON.stringify(joined?.state));
await new Promise((r) => setTimeout(r, 6000));
log('host after join', await host.evaluate(() => window.__pget()));
log('guest after join', await guest.evaluate(() => window.__pget()));

// Chat round trip guest -> host
await guest.evaluate(() => window.__pchat('hello'));
await new Promise((r) => setTimeout(r, 4000));
log('host sees chat?', await host.evaluate(() => window.__pget()));
await guest.evaluate(() => window.__pchat('again'));
await new Promise((r) => setTimeout(r, 4000));
log('host after 2nd chat', await host.evaluate(() => window.__pget()));

// Host next -> guest should follow
await host.evaluate(() => window.__pnext());
await new Promise((r) => setTimeout(r, 5000));
log('host after next', await host.evaluate(() => window.__pget()));
log('guest after next', await guest.evaluate(() => window.__pget()));

// Guest enqueue a track (use search results still on guest)
await guest.evaluate(() => window.__psearch('Carpenters'));
await new Promise((r) => setTimeout(r, 2000));
log('guest enqueue returns', await guest.evaluate(() => window.__penqueue(0)));
await new Promise((r) => setTimeout(r, 4000));
log('host queue after guest enqueue', await host.evaluate(() => window.__pget()));

log('errors', JSON.stringify(errors));
await browser.close();
log('DONE');
