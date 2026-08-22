 // Test-only entrypoint: re-exports the DOs for miniflare's durableObjects
 // bindings and provides a default fetch so the bundle is a valid worker.
 export { PartyRoomDO } from '../workers/party-room';
 export { PartyIndexDO } from '../workers/party-index';
 export default {
   fetch(): Response {
     return new Response('yvxi-party-room DO worker (test bundle)');
   },
 };
