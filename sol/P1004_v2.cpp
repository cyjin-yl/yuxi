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

    // f[k][i][j] = max score when:
    //   person 1 is at (i, k-i) and person 2 is at (j, k-j)
    // k = x1+y1 = x2+y2 (same number of steps from origin)
    memset(f, 0, sizeof(f));

    for (int k = 2; k <= 2 * n; k++) {
        for (int i = 1; i <= n; i++) {
            int j1 = k - i;
            if (j1 < 1 || j1 > n) continue;
            for (int j = 1; j <= n; j++) {
                int j2 = k - j;
                if (j2 < 1 || j2 > n) continue;

                // Previous positions (4 combinations):
                // 1) both came from above: (i-1, j-1) at step k-1
                // 2) both came from left: (i, j) at step k-1
                // 3) p1 from above, p2 from left: (i-1, j)
                // 4) p1 from left, p2 from above: (i, j-1)
                int prev = 0;
                if (k > 2) {
                    prev = max(f[k-1][i-1][j-1], f[k-1][i][j]);
                    prev = max(prev, f[k-1][i-1][j]);
                    prev = max(prev, f[k-1][i][j-1]);
                }

                int val = a[i][j1];
                if (i != j) val += a[j][j2];
                f[k][i][j] = prev + val;
            }
        }
    }

    printf("%d\n", f[2*n][n][n]);
    return 0;
}
