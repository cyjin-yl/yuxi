const api = require('NeteaseCloudMusicApi');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  try {
    const request = JSON.parse(input);
    const cookie = request.cookie;
    const args = request.args || {};
    let response;
    switch (request.operation) {
      case 'playlist':
        response = await api.playlist_detail({ id: String(request.id), s: 8, cookie });
        break;
      case 'lyrics':
        response = await api.lyric_new({ id: String(request.id), cookie });
        break;
      case 'audio':
        response = await api.song_url_v1({ id: String(request.id), level: request.level || 'standard', cookie });
        break;
      case 'qr-key':
        response = await api.login_qr_key({});
        break;
      case 'qr-create':
        response = await api.login_qr_create({ key: String(args.key), qrimg: true });
        break;
      case 'qr-check':
        response = await api.login_qr_check({ key: String(args.key), noCookie: true });
        break;
      case 'account':
        response = await api.login_status({ cookie });
        break;
      case 'likes': {
        const status = await api.login_status({ cookie });
        const uid = status.body?.data?.profile?.userId;
        if (!uid) throw new Error('NetEase session is not authenticated');
        const liked = await api.likelist({ uid: String(uid), cookie });
        const ids = liked.body?.ids || [];
        const songs = [];
        for (let index = 0; index < ids.length; index += 500) {
          const detail = await api.song_detail({ ids: ids.slice(index, index + 500).join(','), cookie });
          songs.push(...(detail.body?.songs || []));
        }
        process.stdout.write(JSON.stringify({ code: 200, uid, ids, songs }));
        return;
      }
      default:
        throw new Error('Unsupported operation');
    }
    process.stdout.write(JSON.stringify(response.body));
  } catch (error) {
    process.stderr.write(String(error.body ? JSON.stringify(error.body) : error.message));
    process.exitCode = 1;
  }
});
