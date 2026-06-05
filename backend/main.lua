local logger = require("logger")
local millennium = require("millennium")
local http = require("http")
local fs = require("fs")

-- Load local json.lua sibling. Millennium's LuaVM doesn't preload cjson, so we ship our own.
package.path = (debug.getinfo(1, "S").source:sub(2):match("(.*/)") or "./") .. "?.lua;" .. package.path
local json = require("json")

local safe_decode = json.decode
local safe_encode = json.encode
local cjson = { null = json.null }  -- compat shim for cjson.null references

local RA_BASE = "https://retroachievements.org/API/"
local BADGE_BASE = "https://media.retroachievements.org/Badge"
local MEDIA_BASE = "https://media.retroachievements.org"
local STEAM_APPDETAILS = "https://store.steampowered.com/api/appdetails"
local STEAM_API_BASE = "https://api.steampowered.com"
local REQUEST_TIMEOUT = 8

-- ── HTTP helpers ──────────────────────────────────────────────────────

local function url_encode(s)
    if not s then return "" end
    return (tostring(s):gsub("([^%w%-_.~])", function(c)
        return string.format("%%%02X", string.byte(c))
    end))
end

-- Returns (data, diagnostic). `diagnostic` is a short human-readable string
-- describing the HTTP outcome (status + body snippet) so failures can be
-- inspected from the frontend debug log.
local function ra_get(endpoint, username, api_key, params)
    local query = "?z=" .. url_encode(username) .. "&y=" .. url_encode(api_key)
    if params then
        for k, v in pairs(params) do
            query = query .. "&" .. k .. "=" .. url_encode(v)
        end
    end
    local url = RA_BASE .. endpoint .. query

    local response, err = http.get(url, { timeout = REQUEST_TIMEOUT })
    if not response then
        logger:error("RA GET failed: " .. tostring(err))
        return nil, "erro de rede: " .. tostring(err)
    end
    local body = tostring(response.body or "")
    if response.status ~= 200 then
        logger:error(string.format("RA GET %s: HTTP %s", endpoint, tostring(response.status)))
        return nil, string.format("HTTP %s — %s", tostring(response.status), body:sub(1, 220))
    end
    local data = safe_decode(body)
    if data == nil then
        return nil, "JSON inválido — " .. body:sub(1, 220)
    end
    return data, "HTTP 200 — " .. body:sub(1, 220)
end

-- ── String normalisation for fuzzy match ──────────────────────────────

local function strip_accents(s)
    -- Map common accented Latin chars to their base form.
    local map = {
        ["á"] = "a", ["à"] = "a", ["â"] = "a", ["ã"] = "a", ["ä"] = "a",
        ["é"] = "e", ["è"] = "e", ["ê"] = "e", ["ë"] = "e",
        ["í"] = "i", ["ì"] = "i", ["î"] = "i", ["ï"] = "i",
        ["ó"] = "o", ["ò"] = "o", ["ô"] = "o", ["õ"] = "o", ["ö"] = "o",
        ["ú"] = "u", ["ù"] = "u", ["û"] = "u", ["ü"] = "u",
        ["ç"] = "c", ["ñ"] = "n",
        ["Á"] = "a", ["À"] = "a", ["Â"] = "a", ["Ã"] = "a", ["Ä"] = "a",
        ["É"] = "e", ["È"] = "e", ["Ê"] = "e", ["Ë"] = "e",
        ["Í"] = "i", ["Ì"] = "i", ["Î"] = "i", ["Ï"] = "i",
        ["Ó"] = "o", ["Ò"] = "o", ["Ô"] = "o", ["Õ"] = "o", ["Ö"] = "o",
        ["Ú"] = "u", ["Ù"] = "u", ["Û"] = "u", ["Ü"] = "u",
        ["Ç"] = "c", ["Ñ"] = "n",
    }
    for k, v in pairs(map) do s = s:gsub(k, v) end
    return s
end

local function normalize(text)
    text = strip_accents(text):lower()
    text = text:gsub("[^a-z0-9 ]", " "):gsub("%s+", " ")
    return (text:gsub("^%s*(.-)%s*$", "%1"))
end

local function tokenize(s)
    local tokens = {}
    for tok in s:gmatch("%S+") do tokens[tok] = true end
    return tokens
end

local function score_match(steam_name, candidate_title)
    local a = normalize(steam_name)
    local b = normalize(candidate_title)
    if a == b then return 1.0 end

    local ta, tb = tokenize(a), tokenize(b)
    local inter, union = 0, 0
    for k in pairs(ta) do if tb[k] then inter = inter + 1 end; union = union + 1 end
    for k in pairs(tb) do if not ta[k] then union = union + 1 end end
    if union == 0 then return 0.0 end

    local jaccard = inter / union
    if a:sub(1, #b) == b or b:sub(1, #a) == a then
        jaccard = math.min(1.0, jaccard + 0.2)
    end
    return jaccard
end

-- Search-oriented scorer: a short user query against a full game title.
-- Substring hits dominate — Jaccard is too weak for partial queries
-- ("zelda" vs "The Legend of Zelda: A Link to the Past").
local function score_search(query, title)
    local q = normalize(query)
    local t = normalize(title)
    if q == "" or t == "" then return 0 end
    if t == q then return 1.0 end
    local pos = t:find(q, 1, true)
    if pos then
        -- earlier match and shorter title rank higher
        return 0.95 - math.min(0.25, (pos - 1) * 0.03) - math.min(0.2, (#t - #q) * 0.004)
    end
    -- fall back to: how many query tokens appear anywhere in the title
    local tt = tokenize(t)
    local total, hit = 0, 0
    for tok in q:gmatch("%S+") do
        total = total + 1
        if tt[tok] then hit = hit + 1 end
    end
    if total == 0 then return 0 end
    return (hit / total) * 0.6
end

-- ── IPC: Validation ──────────────────────────────────────────────────

-- Parameters MUST be alphabetical: Millennium IPC sorts argumentList keys
-- alphabetically before unpacking into positional Lua args.
function validate_credentials(api_key, username)
    logger:info(string.format("validate_credentials called: u=%s key_len=%d", tostring(username), api_key and #api_key or 0))
    local data = ra_get("API_GetUserProfile.php", username, api_key, { u = username })
    if data and data.User then
        return safe_encode({ success = true, error = cjson.null })
    end
    return safe_encode({ success = false, error = "Credenciais inválidas" })
end

-- ── IPC: Search ──────────────────────────────────────────────────────

function search_ra_games(api_key, query, username)
    logger:info(string.format("search_ra_games called: u=%s query=%s", tostring(username), tostring(query)))
    local data, diag = ra_get("API_GetGameSearch.php", username, api_key, { q = query })

    local out = {}
    if data and type(data) == "table" then
        for _, r in ipairs(data) do
            if r.ID then
                table.insert(out, {
                    id = tonumber(r.ID),
                    title = r.Title or "",
                    console = r.ConsoleName or "",
                    icon = MEDIA_BASE .. (r.ImageIcon or ""),
                })
            end
        end
    end
    -- `diag` carries the raw RA response so a failed/empty search is inspectable.
    return safe_encode({ results = out, diag = tostring(diag) })
end

-- ── IPC: Console list & per-console search ───────────────────────────
-- The documented way to search RA by name: pick a console, pull its full
-- game list (API_GetGameList.php), and match locally. API_GetGameSearch.php
-- (used above) is undocumented and returns nothing usable.

function get_ra_consoles(api_key, username)
    logger:info("get_ra_consoles called: u=" .. tostring(username))
    -- g=1: game systems only (skip Hubs/Events); a=1: only consoles with games.
    local data, diag = ra_get("API_GetConsoleIDs.php", username, api_key, { g = 1, a = 1 })
    local out = {}
    if data and type(data) == "table" then
        for _, c in ipairs(data) do
            if c.ID then
                table.insert(out, { id = tonumber(c.ID), name = c.Name or "" })
            end
        end
    end
    table.sort(out, function(a, b) return a.name < b.name end)
    return safe_encode({ consoles = out, diag = tostring(diag) })
end

-- Per-console game lists are large; cache each one for the process lifetime.
local game_list_cache = {}

local function get_console_game_list(api_key, console_id, username)
    local key = tostring(console_id)
    if game_list_cache[key] then return game_list_cache[key], "cache" end
    -- f=1: only games that actually have achievements.
    local data, diag = ra_get("API_GetGameList.php", username, api_key, { i = console_id, f = 1 })
    if not data or type(data) ~= "table" then return nil, diag end
    local list = {}
    for _, g in ipairs(data) do
        if g.ID then
            table.insert(list, {
                id = tonumber(g.ID),
                title = g.Title or "",
                console = g.ConsoleName or "",
                icon = MEDIA_BASE .. (g.ImageIcon or ""),
            })
        end
    end
    game_list_cache[key] = list
    return list, diag
end

function search_console_games(api_key, console_id, query, username)
    logger:info(string.format("search_console_games: console=%s query=%s",
        tostring(console_id), tostring(query)))
    local list, diag = get_console_game_list(api_key, console_id, username)
    if not list then
        return safe_encode({ results = {}, diag = "lista do console falhou: " .. tostring(diag) })
    end

    local scored = {}
    for _, g in ipairs(list) do
        local s = score_search(query, g.title)
        if s > 0.1 then
            table.insert(scored, {
                id = g.id, title = g.title, console = g.console, icon = g.icon, score = s,
            })
        end
    end
    table.sort(scored, function(a, b) return a.score > b.score end)

    local results = {}
    for i = 1, math.min(30, #scored) do
        results[i] = {
            id = scored[i].id, title = scored[i].title,
            console = scored[i].console, icon = scored[i].icon,
        }
    end
    return safe_encode({
        results = results,
        diag = string.format("%d jogos no console · %d com correspondência", #list, #scored),
    })
end

-- ── IPC: Resolve Steam → RA ──────────────────────────────────────────

-- steam_name comes from the Steam *client* (works for non-Steam shortcuts).
-- Falls back to the Steam store HTTP API only when no name was supplied,
-- which only ever succeeds for real Steam apps.
function resolve_steam_game(api_key, steam_app_id, steam_name, username)
    logger:info(string.format("resolve_steam_game called: u=%s app=%s name=%s",
        tostring(username), tostring(steam_app_id), tostring(steam_name)))

    local function empty(reason)
        return safe_encode({
            found = false, confidence = "none",
            ra_game_id = cjson.null, ra_title = cjson.null,
            candidates = {}, steam_name = steam_name or cjson.null,
            error = reason,
        })
    end

    local name = steam_name
    if not name or name == "" then
        -- Fallback: Steam store appdetails (real Steam apps only).
        local response = http.get(STEAM_APPDETAILS .. "?appids=" .. steam_app_id .. "&filters=basic", {
            timeout = REQUEST_TIMEOUT
        })
        if response and response.status == 200 then
            local payload = safe_decode(response.body)
            if payload and payload[steam_app_id] and payload[steam_app_id].success
                and payload[steam_app_id].data then
                name = payload[steam_app_id].data.name
            end
        end
    end
    if not name or name == "" then
        return empty("Sem nome do jogo para buscar")
    end

    -- Search RetroAchievements by name.
    local search_data, diag = ra_get("API_GetGameSearch.php", username, api_key, { q = name })
    if not search_data or type(search_data) ~= "table" or #search_data == 0 then
        return empty(string.format("busca q='%s' → %s", name, tostring(diag)))
    end

    -- Score every candidate against the Steam name.
    local scored = {}
    for _, c in ipairs(search_data) do
        if c.ID then
            table.insert(scored, {
                id = tonumber(c.ID),
                title = c.Title or "",
                console = c.ConsoleName or "",
                icon = MEDIA_BASE .. (c.ImageIcon or ""),
                score = score_match(name, c.Title or ""),
            })
        end
    end
    if #scored == 0 then
        return empty(string.format("busca q='%s' sem IDs → %s", name, tostring(diag)))
    end
    table.sort(scored, function(a, b) return a.score > b.score end)

    local best = scored[1]
    local confidence
    if best.score >= 0.85 then confidence = "high"
    elseif best.score >= 0.4 then confidence = "low"
    else confidence = "none" end

    local candidates = {}
    for i = 1, math.min(10, #scored) do
        candidates[i] = {
            id = scored[i].id,
            title = scored[i].title,
            console = scored[i].console,
            icon = scored[i].icon,
        }
    end

    return safe_encode({
        found = confidence ~= "none",
        confidence = confidence,
        ra_game_id = confidence ~= "none" and best.id or cjson.null,
        ra_title = confidence ~= "none" and best.title or cjson.null,
        candidates = candidates,
        steam_name = name,
        error = cjson.null,
    })
end

-- ── IPC: Achievements ────────────────────────────────────────────────

function get_achievements(api_key, ra_game_id, username)
    logger:info(string.format("get_achievements called: u=%s g=%s", tostring(username), tostring(ra_game_id)))
    local data = ra_get("API_GetGameInfoAndUserProgress.php", username, api_key, {
        u = username, g = ra_game_id,
    })
    if not data then
        return safe_encode({ status = "error", error = "Falha ao buscar achievements" })
    end

    local achievements = {}
    local earned, earned_hc, points, total_points = 0, 0, 0, 0
    for ach_id, ach in pairs(data.Achievements or {}) do
        local badge = ach.BadgeName or ""
        local pts = tonumber(ach.Points) or 0
        local has = ach.DateEarned ~= nil and ach.DateEarned ~= cjson.null
        local has_hc = ach.DateEarnedHardcore ~= nil and ach.DateEarnedHardcore ~= cjson.null
        if has then earned = earned + 1; points = points + pts end
        if has_hc then earned_hc = earned_hc + 1 end
        total_points = total_points + pts

        table.insert(achievements, {
            id = tonumber(ach_id),
            title = ach.Title or "",
            description = ach.Description or "",
            points = pts,
            badge_url = BADGE_BASE .. "/" .. badge .. ".png",
            badge_locked_url = BADGE_BASE .. "/" .. badge .. "_lock.png",
            earned = has,
            earned_hardcore = has_hc,
            date_earned = ach.DateEarned,
            date_earned_hardcore = ach.DateEarnedHardcore,
            display_order = tonumber(ach.DisplayOrder) or 0,
            num_awarded = tonumber(ach.NumAwarded) or 0,
            num_awarded_hardcore = tonumber(ach.NumAwardedHardcore) or 0,
        })
    end

    table.sort(achievements, function(a, b) return a.display_order < b.display_order end)

    return safe_encode({
        status = "ok",
        game = {
            id = tonumber(data.ID) or ra_game_id,
            title = data.Title or "",
            console = data.ConsoleName or "",
            icon_url = MEDIA_BASE .. (data.ImageIcon or ""),
        },
        progress = {
            earned = earned,
            earned_hardcore = earned_hc,
            total = #achievements,
            points = points,
            total_points = total_points,
        },
        achievements = achievements,
    })
end

-- ── Local-achievement (Steam-emulator) helpers ───────────────────────
-- Cracked games run under a Steam-API emulator (Goldberg / RUNE / ...)
-- which writes the unlocked-achievement state to a file inside the game's
-- Wine prefix. We locate that file via the non-Steam shortcut's exe path
-- (read from shortcuts.vdf) and pair it with the Steam achievement schema.

-- Minimal binary-VDF reader. shortcuts.vdf uses 4 type bytes:
--   0x00 = nested map, 0x01 = string, 0x02 = int32, 0x08 = end-of-map.
local function parse_binary_vdf(data)
    local pos = 1
    local function read_cstring()
        local e = data:find("\0", pos, true)
        if not e then pos = #data + 1; return "" end
        local s = data:sub(pos, e - 1)
        pos = e + 1
        return s
    end
    local function read_int32()
        if pos + 3 > #data then pos = #data + 1; return 0 end
        local a = data:byte(pos) or 0
        local b = data:byte(pos + 1) or 0
        local c = data:byte(pos + 2) or 0
        local d = data:byte(pos + 3) or 0
        pos = pos + 4
        return a + b * 256 + c * 65536 + d * 16777216
    end
    local function read_map()
        local t = {}
        while pos <= #data do
            local typ = data:byte(pos); pos = pos + 1
            if not typ or typ == 0x08 then break end
            local key = read_cstring()
            if typ == 0x00 then
                t[key] = read_map()
            elseif typ == 0x01 then
                t[key] = read_cstring()
            elseif typ == 0x02 then
                t[key] = read_int32()
            else
                break  -- unknown type; we can't know its length
            end
        end
        return t
    end
    return read_map()
end

local function read_file_bytes(path)
    local f = io.open(path, "rb")
    if not f then return nil end
    local data = f:read("*a")
    f:close()
    return data
end

local function write_file_bytes(path, data)
    local f, err = io.open(path, "wb")
    if not f then return false, err end
    f:write(data or "")
    f:close()
    return true
end

local function fs_entry_name(entry)
    if type(entry) == "string" then return entry end
    if type(entry) == "table" then
        local value = entry.name or entry.file_name or entry.filename or entry.path or entry[1]
        if type(value) == "string" then
            return value:match("[^/\\]+$") or value
        end
    end
    return nil
end

local function path_clean(path)
    if not path or path == "" then return nil end
    local p = tostring(path):gsub('^"', ""):gsub('"$', "")
    return (p:gsub("\\", "/"))
end

local function path_dirname(path)
    local p = path_clean(path)
    if not p then return nil end
    local dir = p:match("^(.*)/[^/]*$")
    if dir and dir ~= "" then return dir end
    return nil
end

local function is_windows()
    local os_name = ""
    if os and type(os.getenv) == "function" then
        local ok, value = pcall(os.getenv, "OS")
        if ok then os_name = tostring(value or "") end
    end
    if os_name:lower():find("windows", 1, true) then return true end
    return package.config and package.config:sub(1, 1) == "\\"
end

local function shell_quote(path)
    local p = path_clean(path)
    if not p or p:find("\0", 1, true) then return nil end
    if is_windows() then
        if p:find("[%%&|<>^]") then return nil end
        return '"' .. p:gsub('"', ""):gsub("/", "\\") .. '"'
    end
    return "'" .. p:gsub("'", "'\\''") .. "'"
end

local function ensure_dir(path)
    local p = path_clean(path)
    if not p or p == "" then return false, "caminho invalido" end
    if fs.is_directory(p) then return true end
    local quoted = shell_quote(p)
    if not quoted then return false, "caminho invalido" end
    local cmd = is_windows() and ("mkdir " .. quoted) or ("mkdir -p " .. quoted)
    local ok = os.execute(cmd)
    if ok == true or ok == 0 then
        return fs.is_directory(p), fs.is_directory(p) and nil or "diretorio nao criado"
    end
    return false, "mkdir falhou"
end

local function push_unique(list, value)
    if not value or value == "" then return end
    for _, existing in ipairs(list) do
        if existing == value then return end
    end
    table.insert(list, value)
end

local function starts_with(value, prefix)
    value = tostring(value or "")
    return value:sub(1, #prefix) == prefix
end

local function read_appid_text_file(path)
    local raw = read_file_bytes(path)
    if not raw then return nil end
    return tonumber(raw:match("(%d+)"))
end

local function read_appid_ini_file(path)
    local raw = read_file_bytes(path)
    if not raw then return nil end
    return tonumber(raw:match("[Aa]pp[Ii]d%s*=%s*(%d+)") or raw:match("[Aa]ppID%s*=%s*(%d+)"))
end

local function get_env(name)
    if not os or type(os.getenv) ~= "function" then return nil end
    local ok, value = pcall(os.getenv, name)
    if ok then return value end
    return nil
end

-- shortcuts.vdf lives at <steam>/userdata/<accountid>/config/shortcuts.vdf
local function find_shortcuts_vdf()
    local steam = millennium.steam_path()
    if not steam or steam == "" then return nil end
    local userdata = steam .. "/userdata"
    if not fs.is_directory(userdata) then return nil end
    for _, entry in ipairs(fs.list(userdata) or {}) do
        local name = fs_entry_name(entry)
        if name then
            local candidate = userdata .. "/" .. name .. "/config/shortcuts.vdf"
            if fs.is_file(candidate) then return candidate end
        end
    end
    return nil
end

local function read_shortcuts()
    local path = find_shortcuts_vdf()
    if not path then return {} end
    local data = read_file_bytes(path)
    if not data then return {} end
    local root = parse_binary_vdf(data)
    -- Top level is either { shortcuts = { "0" = {...}, ... } } or the
    -- entries map directly, depending on Steam version.
    local entries = root.shortcuts or root.Shortcuts or root
    if type(entries) ~= "table" then return {} end
    local function get(t, ...)
        for i = 1, select("#", ...) do
            local k = select(i, ...)
            if t[k] ~= nil then return t[k] end
        end
        return nil
    end
    local list = {}
    for _, entry in pairs(entries) do
        if type(entry) == "table" then
            table.insert(list, {
                appid = get(entry, "appid", "AppId", "AppID"),
                appname = get(entry, "appname", "AppName"),
                exe = get(entry, "exe", "Exe"),
                start_dir = get(entry, "StartDir", "startdir"),
                launch_options = get(entry, "LaunchOptions", "launchoptions"),
            })
        end
    end
    return list
end

local function infer_real_appid(shortcut)
    if not shortcut then return nil end
    local dirs = {}
    push_unique(dirs, path_clean(shortcut.start_dir))
    push_unique(dirs, path_dirname(shortcut.exe))

    for _, dir in ipairs(dirs) do
        local id = read_appid_text_file(dir .. "/steam_appid.txt")
            or read_appid_text_file(dir .. "/steam_settings/steam_appid.txt")
            or read_appid_ini_file(dir .. "/steam_emu.ini")
            or read_appid_ini_file(dir .. "/RUNE.ini")
        if id then return id end
    end

    return nil
end

-- Match a shortcut by appid (signed int32 in shortcuts.vdf ↔ unsigned
-- uint32 in the library URL) or by exact name as a fallback.
local function find_shortcut(target_appid, target_name)
    local n = tonumber(target_appid)
    local shortcuts = read_shortcuts()
    if n then
        local u = (n >= 0) and n or (n + 0x100000000)
        for _, s in ipairs(shortcuts) do
            local a = tonumber(s.appid)
            if a then
                local au = (a >= 0) and a or (a + 0x100000000)
                if a == n or au == u or a == u or au == n then return s end
            end
        end
    end
    if target_name and target_name ~= "" then
        for _, s in ipairs(shortcuts) do
            if s.appname == target_name then return s end
        end
    end
    return nil
end

-- Candidate Wine prefixes for a shortcut: (1) the prefix derived from the
-- exe path if it sits inside a drive_c/ tree (custom prefixes like SH2's
-- ~/Games/sh2-prefix), (2) Steam's compatdata prefix for the shortcut
-- (used when launched via Proton).
local function derive_prefixes(exe_path, shortcut_appid)
    local prefixes = {}
    if exe_path and exe_path ~= "" then
        local p = path_clean(exe_path)
        local prefix = p:match("^(.-)/drive_c/")
        if prefix and prefix ~= "" then table.insert(prefixes, prefix) end
    end
    local steam = millennium.steam_path()
    if steam and steam ~= "" and shortcut_appid then
        local cd = steam .. "/steamapps/compatdata/" .. tostring(shortcut_appid) .. "/pfx"
        if fs.is_directory(cd) then table.insert(prefixes, cd) end
    end
    return prefixes
end

local function add_goldberg_saves(out, root, source)
    if not root or not fs.is_directory(root) then return end
    for _, appid_entry in ipairs(fs.list(root) or {}) do
        local appid = fs_entry_name(appid_entry)
        local numeric_appid = tonumber(appid)
        if numeric_appid and appid ~= "settings" then
            local state = root .. "/" .. appid .. "/achievements.json"
            if fs.is_file(state) then
                table.insert(out, {
                    emulator = "goldberg",
                    real_appid = numeric_appid,
                    state = state,
                    source = source,
                })
            end
        end
    end
end

local function add_rune_saves(out, root, source)
    if not root or not fs.is_directory(root) then return end
    for _, appid_entry in ipairs(fs.list(root) or {}) do
        local appid = fs_entry_name(appid_entry)
        local numeric_appid = tonumber(appid)
        if numeric_appid then
            local state = root .. "/" .. appid .. "/achievements.ini"
            if fs.is_file(state) then
                table.insert(out, {
                    emulator = "rune",
                    real_appid = numeric_appid,
                    state = state,
                    source = source,
                })
            end
        end
    end
end

-- Collect Steam-emulator save files inside a Proton/Wine prefix. Goldberg
-- writes under each user's AppData/Roaming; RUNE writes under Public Documents.
local function collect_prefix_emulator_saves(prefix)
    local out = {}
    local users_dir = prefix .. "/drive_c/users"
    if not fs.is_directory(users_dir) then return out end

    for _, user_entry in ipairs(fs.list(users_dir) or {}) do
        local user = fs_entry_name(user_entry)
        if user then
            local g_root = users_dir .. "/" .. user .. "/AppData/Roaming/Goldberg SteamEmu Saves"
            add_goldberg_saves(out, g_root, "prefix:" .. prefix)
        end
    end

    local rune_root = users_dir .. "/Public/Documents/Steam/RUNE"
    add_rune_saves(out, rune_root, "prefix:" .. prefix)

    return out
end

local function collect_native_emulator_saves()
    local out = {}

    local appdata = path_clean(get_env("APPDATA"))
    local userprofile = path_clean(get_env("USERPROFILE"))
    local public = path_clean(get_env("PUBLIC")) or "C:/Users/Public"

    if appdata then
        add_goldberg_saves(out, appdata .. "/Goldberg SteamEmu Saves", "windows:APPDATA")
    end
    if userprofile then
        add_goldberg_saves(out, userprofile .. "/AppData/Roaming/Goldberg SteamEmu Saves", "windows:USERPROFILE")
    end

    add_rune_saves(out, public .. "/Documents/Steam/RUNE", "windows:PUBLIC")
    add_rune_saves(out, "C:/Users/Public/Documents/Steam/RUNE", "windows:public-default")

    return out
end

local function collect_emulator_saves(prefixes)
    local out = {}
    local seen = {}
    local function add(found)
        local key = found.emulator .. ":" .. tostring(found.real_appid) .. ":" .. tostring(found.state)
        if seen[key] then return end
        seen[key] = true
        table.insert(out, found)
    end
    for _, prefix in ipairs(prefixes or {}) do
        for _, found in ipairs(collect_prefix_emulator_saves(prefix)) do
            add(found)
        end
    end
    for _, found in ipairs(collect_native_emulator_saves()) do
        add(found)
    end
    return out
end

local function collect_all_emulator_saves()
    local prefixes = {}
    for _, shortcut in ipairs(read_shortcuts()) do
        for _, prefix in ipairs(derive_prefixes(shortcut.exe, shortcut.appid)) do
            push_unique(prefixes, prefix)
        end
    end
    return collect_emulator_saves(prefixes)
end

local function default_backup_dir()
    local home = path_clean(get_env("USERPROFILE")) or path_clean(get_env("HOME"))
    if not home then
        local steam = path_clean(millennium.steam_path())
        if steam then return steam .. "/achievement-companion-backups" end
        return nil
    end
    return home .. "/Documents/Achievement Companion"
end

local function backup_file_name()
    return "achievement-companion-local-" .. os.date("!%Y%m%d-%H%M%S") .. ".json"
end

local function add_restore_root(out, root)
    local clean = path_clean(root)
    if not clean or clean == "" then return end
    for _, existing in ipairs(out) do
        if existing == clean then return end
    end
    table.insert(out, clean)
end

local function native_restore_roots(emulator)
    local out = {}
    if emulator == "goldberg" then
        local appdata = path_clean(get_env("APPDATA"))
        local userprofile = path_clean(get_env("USERPROFILE"))
        if appdata then add_restore_root(out, appdata .. "/Goldberg SteamEmu Saves") end
        if userprofile then add_restore_root(out, userprofile .. "/AppData/Roaming/Goldberg SteamEmu Saves") end
    elseif emulator == "rune" then
        local public = path_clean(get_env("PUBLIC")) or "C:/Users/Public"
        add_restore_root(out, public .. "/Documents/Steam/RUNE")
        add_restore_root(out, "C:/Users/Public/Documents/Steam/RUNE")
    end
    return out
end

local function prefix_restore_roots(real_appid, emulator, game_name)
    local out = {}
    local wanted_name = normalize(game_name or "")
    for _, shortcut in ipairs(read_shortcuts()) do
        local inferred = infer_real_appid(shortcut)
        local name_matches = wanted_name ~= "" and normalize(shortcut.appname or "") == wanted_name
        if inferred == real_appid or name_matches then
            for _, prefix in ipairs(derive_prefixes(shortcut.exe, shortcut.appid)) do
                local users_dir = prefix .. "/drive_c/users"
                if fs.is_directory(users_dir) then
                    if emulator == "goldberg" then
                        for _, user_entry in ipairs(fs.list(users_dir) or {}) do
                            local user = fs_entry_name(user_entry)
                            if user and user ~= "Public" then
                                add_restore_root(out, users_dir .. "/" .. user .. "/AppData/Roaming/Goldberg SteamEmu Saves")
                            end
                        end
                        add_restore_root(out, users_dir .. "/steamuser/AppData/Roaming/Goldberg SteamEmu Saves")
                    elseif emulator == "rune" then
                        add_restore_root(out, users_dir .. "/Public/Documents/Steam/RUNE")
                    end
                end
            end
        end
    end
    return out
end

local function source_restore_roots(source, emulator)
    local out = {}
    local prefix = tostring(source or ""):match("^prefix:(.+)$")
    if not prefix then return out end
    local users_dir = prefix .. "/drive_c/users"
    if not fs.is_directory(users_dir) then return out end
    if emulator == "goldberg" then
        for _, user_entry in ipairs(fs.list(users_dir) or {}) do
            local user = fs_entry_name(user_entry)
            if user and user ~= "Public" then
                add_restore_root(out, users_dir .. "/" .. user .. "/AppData/Roaming/Goldberg SteamEmu Saves")
            end
        end
    elseif emulator == "rune" then
        add_restore_root(out, users_dir .. "/Public/Documents/Steam/RUNE")
    end
    return out
end

local function restore_roots(real_appid, emulator, game_name, source)
    local out = {}
    for _, root in ipairs(source_restore_roots(source, emulator)) do
        add_restore_root(out, root)
    end
    for _, root in ipairs(prefix_restore_roots(real_appid, emulator, game_name)) do
        add_restore_root(out, root)
    end
    for _, root in ipairs(native_restore_roots(emulator)) do
        add_restore_root(out, root)
    end
    return out
end

local function emulator_state_file(emulator)
    if emulator == "goldberg" then return "achievements.json" end
    if emulator == "rune" then return "achievements.ini" end
    return nil
end

local function export_local_achievement_backup_impl()
    local saves = {}
    for _, found in ipairs(collect_all_emulator_saves()) do
        local raw = read_file_bytes(found.state)
        if raw and #raw <= 5 * 1024 * 1024 then
            table.insert(saves, {
                emulator = found.emulator,
                steam_app_id = found.real_appid,
                source = found.source,
                file_name = emulator_state_file(found.emulator) or "",
                content = raw,
            })
        end
    end

    table.sort(saves, function(a, b)
        if a.steam_app_id == b.steam_app_id then return tostring(a.emulator) < tostring(b.emulator) end
        return tonumber(a.steam_app_id) < tonumber(b.steam_app_id)
    end)

    local dir = default_backup_dir()
    if not dir then
        return safe_encode({ status = "error", error = "nao foi possivel encontrar a pasta Documents" })
    end
    local ok_dir, dir_err = ensure_dir(dir)
    if not ok_dir then
        return safe_encode({ status = "error", error = "nao foi possivel criar pasta de backup: " .. tostring(dir_err) })
    end

    local path = dir .. "/" .. backup_file_name()
    local payload = safe_encode({
        format = "achievement-companion-local-backup",
        version = 1,
        exported_at = os.date("!%Y-%m-%dT%H:%M:%SZ"),
        saves = saves,
    })
    local ok_write, write_err = write_file_bytes(path, payload)
    if not ok_write then
        return safe_encode({ status = "error", error = "falha ao escrever backup: " .. tostring(write_err) })
    end
    return safe_encode({ status = "ok", path = path, saves = #saves })
end

local function import_local_achievement_backup_impl(path)
    local clean_path = path_clean(path)
    if not clean_path or clean_path == "" then
        return safe_encode({ status = "error", error = "informe o caminho do arquivo de backup" })
    end
    if not clean_path:lower():match("%.json$") then
        return safe_encode({ status = "error", error = "o backup precisa ser um arquivo .json" })
    end
    local raw = read_file_bytes(clean_path)
    if not raw then
        return safe_encode({ status = "error", error = "backup nao encontrado" })
    end
    if #raw > 20 * 1024 * 1024 then
        return safe_encode({ status = "error", error = "backup muito grande" })
    end

    local ok_decode, backup = pcall(safe_decode, raw)
    if not ok_decode or type(backup) ~= "table" then
        return safe_encode({ status = "error", error = "JSON de backup invalido" })
    end
    if backup.format ~= "achievement-companion-local-backup" or tonumber(backup.version) ~= 1 then
        return safe_encode({ status = "error", error = "arquivo nao parece ser um backup do Achievement Companion" })
    end
    if type(backup.saves) ~= "table" then
        return safe_encode({ status = "error", error = "backup sem lista de saves" })
    end

    local imported, failed = 0, {}
    local written = {}
    for _, save in ipairs(backup.saves) do
        local emulator = tostring(save.emulator or "")
        local real_appid = tonumber(save.steam_app_id)
        local content = type(save.content) == "string" and save.content or nil
        local file_name = emulator_state_file(emulator)
        if not real_appid or not file_name or not content or #content > 5 * 1024 * 1024 then
            table.insert(failed, { steam_app_id = save.steam_app_id, emulator = emulator, error = "entrada invalida" })
        else
            local roots = restore_roots(real_appid, emulator, save.game_name, save.source)
            if #roots == 0 then
                table.insert(failed, { steam_app_id = real_appid, emulator = emulator, error = "nenhum destino encontrado" })
            else
                local wrote_one = false
                for _, root in ipairs(roots) do
                    local app_dir = root .. "/" .. tostring(real_appid)
                    local ok_dir, dir_err = ensure_dir(app_dir)
                    if ok_dir then
                        local target = app_dir .. "/" .. file_name
                        local ok_write, write_err = write_file_bytes(target, content)
                        if ok_write then
                            wrote_one = true
                            table.insert(written, { steam_app_id = real_appid, emulator = emulator, path = target })
                        else
                            table.insert(failed, { steam_app_id = real_appid, emulator = emulator, error = tostring(write_err) })
                        end
                    else
                        table.insert(failed, { steam_app_id = real_appid, emulator = emulator, error = tostring(dir_err) })
                    end
                end
                if wrote_one then imported = imported + 1 end
            end
        end
    end

    return safe_encode({
        status = imported > 0 and "ok" or "error",
        imported = imported,
        failed = failed,
        written = written,
    })
end

local function parse_goldberg_state(path)
    local raw = read_file_bytes(path)
    if not raw then return nil end
    local ok, parsed = pcall(safe_decode, raw)
    if not ok or type(parsed) ~= "table" then return nil end
    return parsed  -- { ACH_NAME = { earned=bool, earned_time=int }, ... }
end

local function parse_rune_state(path)
    local raw = read_file_bytes(path)
    if not raw then return {} end
    local count = tonumber(raw:match("Count%s*=%s*(%d+)")) or 0
    if count == 0 then return {} end
    local out, cur = {}, nil
    for line in raw:gmatch("[^\r\n]+") do
        local sec = line:match("^%[(.-)%]$")
        if sec then
            cur = sec
        elseif cur and cur ~= "SteamAchievements" then
            if line:match("HaveAchieved%s*=%s*1") or line:match("Achieved%s*=%s*1") then
                out[cur] = out[cur] or { earned = true, earned_time = 0 }
            end
            local t = line:match("Time%s*=%s*(%d+)") or line:match("UnlockTime%s*=%s*(%d+)")
            if t and out[cur] then out[cur].earned_time = tonumber(t) or 0 end
        end
    end
    return out
end

local function table_size(t)
    local n = 0
    for _ in pairs(t or {}) do n = n + 1 end
    return n
end

local function fallback_local_response(found, state, schema_error)
    local keys = {}
    for key in pairs(state or {}) do table.insert(keys, key) end
    table.sort(keys)

    local achievements = {}
    local earned_count = 0
    for i, key in ipairs(keys) do
        local s = state[key] or {}
        local has = s.earned == true
        if has then earned_count = earned_count + 1 end
        local date_earned = cjson.null
        if has and s.earned_time and s.earned_time > 0 then
            date_earned = os.date("!%Y-%m-%dT%H:%M:%SZ", s.earned_time)
        end
        table.insert(achievements, {
            id = i,
            title = key,
            description = "Conquista local sem catalogo da Steam",
            points = 0,
            badge_url = "",
            badge_locked_url = "",
            earned = has,
            earned_hardcore = false,
            date_earned = date_earned,
            date_earned_hardcore = cjson.null,
            display_order = i,
            num_awarded = 0,
            num_awarded_hardcore = 0,
        })
    end

    return safe_encode({
        status = "ok",
        source = "local",
        schema_missing = true,
        schema_error = schema_error,
        emulator = found.emulator,
        emulator_source = found.source,
        game = {
            id = found.real_appid,
            title = "Steam App " .. tostring(found.real_appid),
            console = "Steam",
            icon_url = "",
        },
        progress = {
            earned = earned_count,
            earned_hardcore = 0,
            total = #achievements,
            points = 0,
            total_points = 0,
        },
        achievements = achievements,
    })
end

local function fetch_steam_schema_lang(steam_api_key, real_appid, language)
    if not steam_api_key or steam_api_key == "" then
        return nil, "sem Steam Web API Key"
    end
    local url = STEAM_API_BASE .. "/ISteamUserStats/GetSchemaForGame/v2/" ..
        "?key=" .. url_encode(steam_api_key) ..
        "&appid=" .. tostring(real_appid) ..
        "&l=" .. url_encode(language)
    local response, err = http.get(url, { timeout = REQUEST_TIMEOUT })
    if not response then return nil, "rede: " .. tostring(err) end
    if response.status ~= 200 then
        return nil, "HTTP " .. tostring(response.status) .. " - " .. tostring(response.body or ""):sub(1, 160)
    end
    local data = safe_decode(response.body or "")
    if type(data) ~= "table" then return nil, "JSON inválido" end
    return data
end

local function non_empty_string(value)
    if type(value) ~= "string" then return nil end
    if value:match("%S") then return value end
    return nil
end

local function schema_achievements(schema)
    local game = type(schema) == "table" and schema.game or nil
    local stats = type(game) == "table" and game.availableGameStats or nil
    local achievements = type(stats) == "table" and stats.achievements or nil
    if type(achievements) == "table" then return achievements end
    return {}
end

local function schema_needs_text_fallback(schema)
    for _, achievement in ipairs(schema_achievements(schema)) do
        if type(achievement) == "table" then
            if not non_empty_string(achievement.displayName) or not non_empty_string(achievement.description) then
                return true
            end
        end
    end
    return false
end

local function schema_achievement_map(schema)
    local out = {}
    for _, achievement in ipairs(schema_achievements(schema)) do
        if type(achievement) == "table" and achievement.name then
            out[tostring(achievement.name)] = achievement
        end
    end
    return out
end

local function fill_missing_achievement_text(target, fallback)
    if type(target) ~= "table" or type(fallback) ~= "table" then return end
    for _, field in ipairs({ "displayName", "description", "icon", "icongray" }) do
        if not non_empty_string(target[field]) and non_empty_string(fallback[field]) then
            target[field] = fallback[field]
        end
    end
end

local function merge_schema_text_fallback(target, fallback)
    if type(target) ~= "table" or type(fallback) ~= "table" then return target end

    local target_game = target.game
    local fallback_game = fallback.game
    if type(target_game) == "table" and type(fallback_game) == "table" then
        if not non_empty_string(target_game.gameName) and non_empty_string(fallback_game.gameName) then
            target_game.gameName = fallback_game.gameName
        end
    end

    local fallback_by_name = schema_achievement_map(fallback)
    for _, achievement in ipairs(schema_achievements(target)) do
        if type(achievement) == "table" and achievement.name then
            fill_missing_achievement_text(achievement, fallback_by_name[tostring(achievement.name)])
        end
    end

    return target
end

local steam_schema_cache = {}

local function fetch_steam_schema_uncached(steam_api_key, real_appid)
    local errors = {}
    for _, lang in ipairs({ "brazilian", "portuguese" }) do
        local schema, err = fetch_steam_schema_lang(steam_api_key, real_appid, lang)
        if schema then
            schema.__ra_lang = lang
            if schema_needs_text_fallback(schema) then
                local english, english_err = fetch_steam_schema_lang(steam_api_key, real_appid, "english")
                if english then
                    schema = merge_schema_text_fallback(schema, english)
                    schema.__ra_lang = lang .. "+english-fallback"
                else
                    table.insert(errors, "english fallback: " .. tostring(english_err))
                end
            end
            return schema
        end
        table.insert(errors, lang .. ": " .. tostring(err))
    end

    local schema, err = fetch_steam_schema_lang(steam_api_key, real_appid, "english")
    if schema then
        schema.__ra_lang = "english"
        return schema
    end
    table.insert(errors, "english: " .. tostring(err))
    return nil, table.concat(errors, "; ")
end

local function fetch_steam_schema(steam_api_key, real_appid)
    local key = tostring(real_appid or "")
    local cached = steam_schema_cache[key]
    if cached then
        return cached.schema
    end

    local schema, err = fetch_steam_schema_uncached(steam_api_key, real_appid)
    if schema then
        steam_schema_cache[key] = { schema = schema }
    end
    return schema, err
end

local function schema_response(real_appid, schema, state, emulator, emulator_source)
    local game = schema.game or {}
    local schema_achs = (game.availableGameStats or {}).achievements or {}

    local achievements = {}
    local earned_count = 0
    state = state or {}
    for i, a in ipairs(schema_achs) do
        local s = state[a.name] or {}
        local has = s.earned == true
        if has then earned_count = earned_count + 1 end
        local date_earned = cjson.null
        if has and s.earned_time and s.earned_time > 0 then
            date_earned = os.date("!%Y-%m-%dT%H:%M:%SZ", s.earned_time)
        end
        table.insert(achievements, {
            id = i,
            title = a.displayName or "",
            description = a.description or "",
            points = 0,
            badge_url = a.icon or "",
            badge_locked_url = a.icongray or "",
            earned = has,
            earned_hardcore = false,
            date_earned = date_earned,
            date_earned_hardcore = cjson.null,
            display_order = i,
            num_awarded = 0,
            num_awarded_hardcore = 0,
        })
    end

    return safe_encode({
        status = "ok",
        source = "local",
        emulator = emulator,
        emulator_source = emulator_source,
        game = {
            id = real_appid,
            title = game.gameName or "",
            console = "Steam",
            icon_url = "",
        },
        progress = {
            earned = earned_count,
            earned_hardcore = 0,
            total = #achievements,
            points = 0,
            total_points = 0,
        },
        achievements = achievements,
    })
end

-- ── IPC: Local (cracked-game) achievements ───────────────────────────

local function get_local_achievements_impl(api_key_steam, app_id, steam_app_id, steam_name)
    logger:info(string.format("get_local_achievements: app=%s steam_app=%s name=%s",
        tostring(app_id), tostring(steam_app_id), tostring(steam_name)))

    local shortcut = find_shortcut(app_id, steam_name)
    if not shortcut then
        return safe_encode({
            status = "no_shortcut",
            error = "atalho não encontrado em shortcuts.vdf",
        })
    end

    local prefixes = derive_prefixes(shortcut.exe, app_id)
    local manual_appid = tonumber(steam_app_id)
    local preferred_appid = manual_appid or infer_real_appid(shortcut)
    local candidates = collect_emulator_saves(prefixes)
    if manual_appid then
        local filtered = {}
        for _, candidate in ipairs(candidates) do
            if candidate.real_appid == manual_appid then
                table.insert(filtered, candidate)
            end
        end
        candidates = filtered
    end

    if #candidates == 0 then
        if manual_appid then
            local schema, schema_err = fetch_steam_schema(api_key_steam, manual_appid)
            if schema then
                return schema_response(manual_appid, schema, {}, "manual", "manual:no-save")
            end
            return safe_encode({
                status = "no_schema",
                error = "schema Steam: " .. tostring(schema_err),
                manual_appid = manual_appid,
                no_save = true,
            })
        end
        return safe_encode({
            status = "no_emulator",
            error = "nenhum arquivo de emulador de Steam (Goldberg/RUNE) encontrado",
            prefixes_tried = prefixes,
            windows_native_tried = true,
            manual_appid = manual_appid,
            exe = shortcut.exe,
        })
    end

    local found, state, schema
    local fallback_found, fallback_state
    local best_score = -1
    local schema_errors = {}
    local skipped_weak_matches = 0
    for _, candidate in ipairs(candidates) do
        local candidate_state
        if candidate.emulator == "goldberg" then
            candidate_state = parse_goldberg_state(candidate.state) or {}
        else
            candidate_state = parse_rune_state(candidate.state) or {}
        end

        local candidate_schema, schema_err = fetch_steam_schema(api_key_steam, candidate.real_appid)
        if candidate_schema then
            local game = candidate_schema.game or {}
            local score = score_match(steam_name or "", game.gameName or "")
            local exact_appid = preferred_appid and candidate.real_appid == preferred_appid
            if preferred_appid and candidate.real_appid == preferred_appid then
                score = score + 2
            elseif #candidates == 1 then
                score = score + 0.5
            end

            -- Windows-native emulator folders are global, so they may contain
            -- saves for many unrelated games. Never auto-pick a weak fuzzy
            -- match from that pool; require manual/inferred appid or a strong
            -- title match.
            if starts_with(candidate.source, "windows:") and not exact_appid and score < 0.72 then
                skipped_weak_matches = skipped_weak_matches + 1
            elseif score > best_score then
                if table_size(candidate_state) > 0 and not fallback_found then
                    fallback_found = candidate
                    fallback_state = candidate_state
                end
                best_score = score
                found = candidate
                state = candidate_state
                schema = candidate_schema
            end
        else
            table.insert(schema_errors, tostring(candidate.real_appid) .. ": " .. tostring(schema_err))
            if preferred_appid and candidate.real_appid == preferred_appid and table_size(candidate_state) > 0 then
                fallback_found = candidate
                fallback_state = candidate_state
            end
        end
    end

    if not found or not schema then
        if fallback_found and fallback_state then
            return fallback_local_response(
                fallback_found,
                fallback_state,
                "schema Steam: " .. table.concat(schema_errors, "; ")
            )
        end
        return safe_encode({
            status = skipped_weak_matches > 0 and "no_match" or "no_schema",
            error = skipped_weak_matches > 0
                and "nenhum save local combinou com este atalho; informe o Steam AppID real"
                or ("schema Steam: " .. table.concat(schema_errors, "; ")),
            emulator_candidates = #candidates,
            preferred_appid = preferred_appid,
            skipped_weak_matches = skipped_weak_matches,
        })
    end

    return schema_response(found.real_appid, schema, state, found.emulator, found.source)
end

-- ── Plugin lifecycle ─────────────────────────────────────────────────

function get_local_achievements(api_key_steam, app_id, steam_app_id, steam_name)
    local ok, result = pcall(get_local_achievements_impl, api_key_steam, app_id, steam_app_id, steam_name)
    if ok then return result end
    logger:error("get_local_achievements failed: " .. tostring(result))
    return safe_encode({
        status = "error",
        error = "backend Lua: " .. tostring(result),
    })
end

function export_local_achievement_backup()
    local ok, result = pcall(export_local_achievement_backup_impl)
    if ok then return result end
    logger:error("export_local_achievement_backup failed: " .. tostring(result))
    return safe_encode({
        status = "error",
        error = "backend Lua: " .. tostring(result),
    })
end

function import_local_achievement_backup(path)
    local ok, result = pcall(import_local_achievement_backup_impl, path)
    if ok then return result end
    logger:error("import_local_achievement_backup failed: " .. tostring(result))
    return safe_encode({
        status = "error",
        error = "backend Lua: " .. tostring(result),
    })
end

local function on_frontend_loaded()
    logger:info("RetroAchievements frontend loaded")
end

local function on_load()
    logger:info("RetroAchievements backend loaded")
    millennium.ready()
end

local function on_unload()
    logger:info("RetroAchievements backend unloaded")
end

return {
    on_frontend_loaded = on_frontend_loaded,
    on_load = on_load,
    on_unload = on_unload,
}
