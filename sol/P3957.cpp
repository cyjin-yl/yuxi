#include <bits/stdc++.h>
using namespace std;

const int N = 105, K = 25;
const int INF = 1e9;
const int dx[] = {-1, 1, 0, 0};
const int dy[] = {0, 0, -1, 1};

int n, k, c;
int g[N][N];
int dp[N][N][K]; // dp[i][j][rem] = min cost to reach (i,j) with rem moves left

int main() {
    scanf("%d%d%d", &n, &k, &c);
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            scanf("%d", &g[i][j]);

    memset(dp, 0x3f, sizeof(dp));
    
    // SPFA on state space (i, j, rem)
    struct State { int i, j, rem; };
    queue<State> q;
    bool inq[N][N][K];
    memset(inq, 0, sizeof(inq));

    dp[0][0][k] = 0;
    q.push({0, 0, k});
    inq[0][0][k] = true;

    while (!q.empty()) {
        auto [x, y, rem] = q.front();
        q.pop();
        inq[x][y][rem] = false;

        for (int d = 0; d < 4; d++) {
            int nx = x + dx[d], ny = y + dy[d];
            if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;

            int cur = g[x][y], tar = g[nx][ny];

            // Same color: cost 0, rem unchanged
            if (cur == tar) {
                int nc = dp[x][y][rem];
                if (nc < dp[nx][ny][rem]) {
                    dp[nx][ny][rem] = nc;
                    if (!inq[nx][ny][rem]) {
                        inq[nx][ny][rem] = true;
                        q.push({nx, ny, rem});
                    }
                }
            }

            // Different color + use a move: cost c, rem-1
            if (cur != tar && rem > 0) {
                int nc = dp[x][y][rem] + c;
                if (nc < dp[nx][ny][rem - 1]) {
                    dp[nx][ny][rem - 1] = nc;
                    if (!inq[nx][ny][rem - 1]) {
                        inq[nx][ny][rem - 1] = true;
                        q.push({nx, ny, rem - 1});
                    }
                }
            }

            // Different color + don't use move: cost +2
            if (cur != tar) {
                int nc = dp[x][y][rem] + 2;
                if (nc < dp[nx][ny][rem]) {
                    dp[nx][ny][rem] = nc;
                    if (!inq[nx][ny][rem]) {
                        inq[nx][ny][rem] = true;
                        q.push({nx, ny, rem});
                    }
                }
            }
        }
    }

    int ans = INF;
    for (int r = 0; r <= k; r++)
        ans = min(ans, dp[n-1][n-1][r]);

    printf("%d\n", ans);
    return 0;
}
