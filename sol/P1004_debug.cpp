#include <bits/stdc++.h>
using namespace std;

const int N = 12;
int a[N][N];
int f[N * 2][N][N]; // f[step][x1][x2]

int main() {
    int n;
    scanf("%d", &n);

    int x, y, v;
    while (true) {
        scanf("%d%d%d", &x, &y, &v);
        if (x == 0 && y == 0 && v == 0) break;
        a[x][y] = v;
    }

    // Print grid for verification
    // for (int i = 1; i <= n; i++) {
    //     for (int j = 1; j <= n; j++)
    //         printf("%3d ", a[i][j]);
    //     puts("");
    // }

    memset(f, 0, sizeof(f));

    // step = 2 means both paths at (1,1)
    for (int s = 3; s <= 2 * n; s++) {
        for (int x1 = 1; x1 <= n; x1++) {
            int y1 = s - x1;
            if (y1 < 1 || y1 > n) continue;
            for (int x2 = 1; x2 <= n; x2++) {
                int y2 = s - x2;
                if (y2 < 1 || y2 > n) continue;

                // From previous step s-1, paths could come from:
                // both up (x1-1, x2-1), both left (x1, x2), 
                // path1 up + path2 left (x1-1, x2), or path1 left + path2 up (x1, x2-1)
                int best = max(f[s-1][x1-1][x2-1], f[s-1][x1][x2]);
                best = max(best, f[s-1][x1-1][x2]);
                best = max(best, f[s-1][x1][x2-1]);

                f[s][x1][x2] = best + a[x1][y1];
                if (x1 != x2)
                    f[s][x1][x2] += a[x2][y2];
            }
        }
    }

    printf("%d\n", f[2*n][n][n]);
    return 0;
}
