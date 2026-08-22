// Test-only entrypoint: re-exports the DO for miniflare's durableObjects
// binding and provides a default fetch so the bundle is a valid worker.
export { PartyRoomDO } from '../workers/party-room';
export default {
  fetch(): Response {
    return new Response('yvxi-party-room DO worker (test bundle)');
  },
};
