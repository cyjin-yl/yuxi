#include <bits/stdc++.h>
using namespace std;

const int N = 15;
int a[N][N];
int dp[N][N][N][N]; // dp[x1][y1][x2][y2]

int main() {
    int n;
    scanf("%d", &n);

    int x, y, v;
    while (scanf("%d%d%d", &x, &y, &v) == 3 && x != 0 && y != 0) {
        a[x][y] = v;
    }

    // Key insight: since both paths move only right/down, and the number of steps
    // from (1,1) to (x,y) is (x-1)+(y-1) = x+y-2, if both paths have taken the
    // same number of steps, then x1+y1 = x2+y2. This reduces 4D to 3D.
    // State: dp[k][x1][x2] where k = x1+y1 = x2+y2, y1 = k-x1, y2 = k-x2.

    int dp2[N][N][N]; // dp2[k][x1][x2]
    memset(dp2, 0, sizeof(dp2));

    for (int k = 2; k <= 2 * n; k++) {
        for (int x1 = max(1, k - n); x1 <= min(n, k - 1); x1++) {
            for (int x2 = max(1, k - n); x2 <= min(n, k - 1); x2++) {
                int y1 = k - x1, y2 = k - x2;
                if (y1 < 1 || y1 > n || y2 < 1 || y2 > n) continue;

                // Four possible previous states: both came from up, both from left,
                // one from up and one from left (two combinations)
                int best = 0;
                for (int d1 = 0; d1 < 2; d1++)
                    for (int d2 = 0; d2 < 2; d2++) {
                        int px1 = x1 - (d1 == 0 ? 1 : 0), py1 = y1 - (d1 == 1 ? 1 : 0);
                        int px2 = x2 - (d2 == 0 ? 1 : 0), py2 = y2 - (d2 == 1 ? 1 : 0);
                        if (px1 >= 1 && px1 <= n && py1 >= 1 && py1 <= n &&
                            px2 >= 1 && px2 <= n && py2 >= 1 && py2 <= n) {
                            best = max(best, dp2[k - 1][px1][px2]);
                        }
                    }

                dp2[k][x1][x2] = best + a[x1][y1];
                if (x1 != x2)
                    dp2[k][x1][x2] += a[x2][y2];
            }
        }
    }

    printf("%d\n", dp2[2 * n][n][n]);
    return 0;
}
