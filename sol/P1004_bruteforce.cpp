#include <bits/stdc++.h>
using namespace std;

const int N = 12;
int a[N][N];
int n;

// Find all paths from (1,1) to (n,n)
struct Path {
    vector<pair<int,int>> cells;
};

void findPaths(int x, int y, vector<pair<int,int>>& cur, vector<Path>& paths) {
    cur.push_back({x, y});
    if (x == n && y == n) {
        paths.push_back({cur});
    } else {
        if (x + 1 <= n) findPaths(x + 1, y, cur, paths);
        if (y + 1 <= n) findPaths(x, y + 1, cur, paths);
    }
    cur.pop_back();
}

int main() {
    scanf("%d", &n);
    int x, y, v;
    while (true) {
        scanf("%d%d%d", &x, &y, &v);
        if (x == 0 && y == 0 && v == 0) break;
        a[x][y] = v;
    }

    vector<Path> paths;
    vector<pair<int,int>> cur;
    findPaths(1, 1, cur, paths);

    int best = 0;
    for (auto& p1 : paths) {
        for (auto& p2 : paths) {
            // Calculate score: each cell counted at most once
            set<pair<int,int>> taken;
            int score = 0;
            for (auto& [r, c] : p1.cells) {
                if (taken.find({r, c}) == taken.end()) {
                    score += a[r][c];
                    taken.insert({r, c});
                }
            }
            for (auto& [r, c] : p2.cells) {
                if (taken.find({r, c}) == taken.end()) {
                    score += a[r][c];
                    taken.insert({r, c});
                }
            }
            if (score > best) best = score;
        }
    }

    printf("%d\n", best);
    return 0;
}
