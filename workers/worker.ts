// Worker entrypoint. Both Durable Object classes live in dedicated files
// and are re-exported here so wrangler can resolve the bindings listed
// in wrangler-party.jsonc.
export { PartyRoomDO } from './party-room';
export { PartyIndexDO } from './party-index';

export default {
  fetch(): Response {
    // The real entrypoint is the Pages Functions /netease/party/* proxy;
    // the worker itself has no public routes.
    return new Response('yvxi-party-room DO worker');
  },
};
