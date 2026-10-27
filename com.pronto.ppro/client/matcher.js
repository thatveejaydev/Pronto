/*
 * PRONTO Search & Ranking Engine
 * Supports multi-token fuzzy/substring scoring, category prefixes (@audio, a:, v:, etc.),
 * UI category filter pills, and Frecency (recent/frequent usage) tie-breaking.
 */
(function (globalScope) {
    'use strict';

    var PREFIX_TO_CATEGORY = {
        'a:': 'Audio', 'audio:': 'Audio', '@a': 'Audio', '@audio': 'Audio', 'sfx:': 'Audio',
        'v:': 'Video', 'video:': 'Video', '@v': 'Video', '@video': 'Video',
        'i:': 'Image', 'img:': 'Image', 'image:': 'Image', '@i': 'Image', '@img': 'Image', '@image': 'Image',
        'g:': 'Graphic', 'gfx:': 'Graphic', 'graphic:': 'Graphic', '@g': 'Graphic', '@graphic': 'Graphic',
        's:': 'Sequence', 'seq:': 'Sequence', 'sequence:': 'Sequence', '@s': 'Sequence', '@seq': 'Sequence',
        'b:': 'Bin', 'bin:': 'Bin', 'folder:': 'Bin', '@b': 'Bin', '@bin': 'Bin'
    };

    function parseQueryTokens(rawQuery) {
        var parts = String(rawQuery || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        var tokens = [];
        var inferredCategory = null;

        for (var i = 0; i < parts.length; i++) {
            var token = parts[i];
            if (PREFIX_TO_CATEGORY[token]) {
                inferredCategory = PREFIX_TO_CATEGORY[token];
                continue;
            }
            var colonIdx = token.indexOf(':');
            if (colonIdx > 0) {
                var prefixWithColon = token.slice(0, colonIdx + 1);
                if (PREFIX_TO_CATEGORY[prefixWithColon]) {
                    inferredCategory = PREFIX_TO_CATEGORY[prefixWithColon];
                    var remainder = token.slice(colonIdx + 1);
                    if (remainder) { tokens.push(remainder); }
                    continue;
                }
            }
            tokens.push(token);
        }

        return {
            tokens: tokens,
            category: inferredCategory
        };
    }

    function scoreToken(haystackLower, tokenLower) {
        if (!tokenLower) { return 0; }
        if (haystackLower === tokenLower) { return 12000; }

        var exactPos = haystackLower.indexOf(tokenLower);
        if (exactPos !== -1) {
            var boundaryBonus = (exactPos === 0 || /[\s_./\\-]/.test(haystackLower.charAt(exactPos - 1))) ? 400 : 0;
            return 6000 + boundaryBonus - (exactPos * 3) - haystackLower.length;
        }

        var cursor = -1;
        var prevIndex = -2;
        var points = 0;
        for (var i = 0; i < tokenLower.length; i++) {
            cursor = haystackLower.indexOf(tokenLower.charAt(i), cursor + 1);
            if (cursor === -1) { return -Infinity; }
            points += 22;
            if (cursor === prevIndex + 1) { points += 28; }
            if (cursor === 0 || /[\s_./\\-]/.test(haystackLower.charAt(cursor - 1))) { points += 18; }
            prevIndex = cursor;
        }
        return points - haystackLower.length;
    }

    function compileIndex(items) {
        var list = items || [];
        var compiled = new Array(list.length);
        for (var i = 0; i < list.length; i++) {
            compiled[i] = {
                nameLower: String(list[i].name || '').toLowerCase(),
                pathLower: String(list[i].path || '').toLowerCase()
            };
        }
        return compiled;
    }

    function computeFrecencyBoost(itemId, recentsMeta) {
        if (!recentsMeta || !recentsMeta[itemId]) { return 0; }
        var entry = recentsMeta[itemId];
        var countBoost = Math.min(entry.count || 1, 10) * 18;
        var recencyBoost = Math.max(0, 60 - (entry.rank || 0) * 5);
        return countBoost + recencyBoost;
    }

    function queryItems(items, rawQuery, compiled, options) {
        options = options || {};
        var list = items || [];
        compiled = compiled || compileIndex(list);

        var parsed = parseQueryTokens(rawQuery);
        var activeCategory = options.category && options.category !== 'All' && options.category !== 'Recent'
            ? options.category
            : parsed.category;
        var tokens = parsed.tokens;
        var recentsMeta = options.recentsMeta || null;

        if ((options.category === 'Recent' || options.showRecentsWhenEmpty) && tokens.length === 0 && !activeCategory) {
            var recentIds = options.recentIds || [];
            var byId = {};
            for (var r = 0; r < list.length; r++) {
                byId[list[r].id] = list[r];
            }
            var outRecents = [];
            for (var k = 0; k < recentIds.length; k++) {
                if (byId[recentIds[k]]) {
                    outRecents.push(byId[recentIds[k]]);
                }
            }
            return outRecents;
        }

        if (tokens.length === 0 && !activeCategory) {
            return [];
        }

        var matches = [];
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (activeCategory && item.kind !== activeCategory) {
                continue;
            }
            var prep = compiled[i];
            var totalScore = 0;
            for (var t = 0; t < tokens.length; t++) {
                var tok = tokens[t];
                var nameRank = scoreToken(prep.nameLower, tok) + 120;
                var pathRank = scoreToken(prep.pathLower, tok);
                var best = nameRank >= pathRank ? nameRank : pathRank;
                if (best === -Infinity) {
                    totalScore = -Infinity;
                    break;
                }
                totalScore += best;
            }
            if (totalScore !== -Infinity) {
                totalScore += computeFrecencyBoost(item.id, recentsMeta);
                matches.push({ item: item, score: totalScore, index: i });
            }
        }

        matches.sort(function (a, b) {
            return (b.score - a.score) || (a.index - b.index);
        });

        var result = new Array(matches.length);
        for (var m = 0; m < matches.length; m++) {
            result[m] = matches[m].item;
        }
        return result;
    }

    var api = {
        parseQueryTokens: parseQueryTokens,
        scoreToken: scoreToken,
        compileIndex: compileIndex,
        queryItems: queryItems
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    globalScope.ProntoMatcher = api;
}(typeof window !== 'undefined' ? window : globalThis));
