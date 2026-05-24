-- Minimal pure-Lua JSON encoder/decoder.
-- Adapted from rxi/json.lua (MIT). Trimmed to encode/decode + nil sentinel.

local json = {}

-- ── Encode ────────────────────────────────────────────────────────────

local encode

local escape_char_map = {
    ["\\"] = "\\\\", ["\""] = "\\\"", ["\b"] = "\\b",
    ["\f"] = "\\f", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t",
}

local function escape_char(c)
    return escape_char_map[c] or string.format("\\u%04x", c:byte())
end

local function encode_nil() return "null" end

local function encode_string(val) return '"' .. val:gsub('[%z\1-\31\\"]', escape_char) .. '"' end

local function encode_number(val)
    if val ~= val or val <= -math.huge or val >= math.huge then
        error("unencodable number: " .. tostring(val))
    end
    if val == math.floor(val) and math.abs(val) < 1e15 then
        return string.format("%d", val)
    end
    return string.format("%.14g", val)
end

local function encode_table(val, stack)
    stack = stack or {}
    if stack[val] then error("circular reference") end
    stack[val] = true

    -- Detect array-like (sequential integer keys 1..n)
    local n, max = 0, 0
    for k in pairs(val) do
        if type(k) ~= "number" then n = -1; break end
        if k > max then max = k end
        n = n + 1
    end

    local out = {}
    if n == max and n > 0 then
        for i = 1, n do out[i] = encode(val[i], stack) end
        stack[val] = nil
        return "[" .. table.concat(out, ",") .. "]"
    elseif n == 0 and next(val) == nil then
        -- Empty table — treat as array (JS expects [] for empty lists more often)
        stack[val] = nil
        return "[]"
    else
        local i = 0
        for k, v in pairs(val) do
            if type(k) ~= "string" then
                error("invalid key type: " .. type(k))
            end
            i = i + 1
            out[i] = encode_string(k) .. ":" .. encode(v, stack)
        end
        stack[val] = nil
        return "{" .. table.concat(out, ",") .. "}"
    end
end

encode = function(val, stack)
    local t = type(val)
    if t == "nil" then return encode_nil() end
    if val == json.null then return encode_nil() end
    if t == "boolean" then return tostring(val) end
    if t == "string" then return encode_string(val) end
    if t == "number" then return encode_number(val) end
    if t == "table" then return encode_table(val, stack) end
    error("unencodable type: " .. t)
end

function json.encode(val)
    local ok, res = pcall(encode, val)
    if ok then return res end
    return "{}"
end

-- ── Decode ────────────────────────────────────────────────────────────

local parse_value

local function skip_ws(s, i)
    while i <= #s do
        local c = s:byte(i)
        if c ~= 32 and c ~= 9 and c ~= 10 and c ~= 13 then return i end
        i = i + 1
    end
    return i
end

local function parse_string(s, i)
    local res, j = {}, i + 1
    while j <= #s do
        local c = s:sub(j, j)
        if c == '"' then return table.concat(res), j + 1 end
        if c == "\\" then
            local n = s:sub(j + 1, j + 1)
            if n == "u" then
                local hex = s:sub(j + 2, j + 5)
                local cp = tonumber(hex, 16)
                if cp and cp < 0x80 then
                    res[#res + 1] = string.char(cp)
                elseif cp and cp < 0x800 then
                    res[#res + 1] = string.char(0xC0 + math.floor(cp / 0x40), 0x80 + cp % 0x40)
                elseif cp then
                    res[#res + 1] = string.char(
                        0xE0 + math.floor(cp / 0x1000),
                        0x80 + math.floor(cp / 0x40) % 0x40,
                        0x80 + cp % 0x40
                    )
                end
                j = j + 6
            else
                local map = { ['"']='"', ["\\"]="\\", ["/"]="/", b="\b", f="\f", n="\n", r="\r", t="\t" }
                res[#res + 1] = map[n] or n
                j = j + 2
            end
        else
            res[#res + 1] = c
            j = j + 1
        end
    end
    error("unterminated string")
end

local function parse_number(s, i)
    local j = i
    while j <= #s do
        local c = s:sub(j, j)
        if c:match("[%-0-9.eE+]") then j = j + 1 else break end
    end
    return tonumber(s:sub(i, j - 1)), j
end

local function parse_literal(s, i)
    if s:sub(i, i + 3) == "true"  then return true,  i + 4 end
    if s:sub(i, i + 4) == "false" then return false, i + 5 end
    if s:sub(i, i + 3) == "null"  then return json.null,  i + 4 end
    error("invalid literal at " .. i)
end

local function parse_array(s, i)
    local res, j = {}, i + 1
    j = skip_ws(s, j)
    if s:sub(j, j) == "]" then return res, j + 1 end
    while true do
        j = skip_ws(s, j)
        local v
        v, j = parse_value(s, j)
        res[#res + 1] = v
        j = skip_ws(s, j)
        local c = s:sub(j, j)
        if c == "," then j = j + 1
        elseif c == "]" then return res, j + 1
        else error("expected , or ] at " .. j) end
    end
end

local function parse_object(s, i)
    local res, j = {}, i + 1
    j = skip_ws(s, j)
    if s:sub(j, j) == "}" then return res, j + 1 end
    while true do
        j = skip_ws(s, j)
        if s:sub(j, j) ~= '"' then error("expected string key at " .. j) end
        local k
        k, j = parse_string(s, j)
        j = skip_ws(s, j)
        if s:sub(j, j) ~= ":" then error("expected : at " .. j) end
        j = skip_ws(s, j + 1)
        local v
        v, j = parse_value(s, j)
        res[k] = v
        j = skip_ws(s, j)
        local c = s:sub(j, j)
        if c == "," then j = j + 1
        elseif c == "}" then return res, j + 1
        else error("expected , or } at " .. j) end
    end
end

parse_value = function(s, i)
    i = skip_ws(s, i)
    local c = s:sub(i, i)
    if c == "{" then return parse_object(s, i) end
    if c == "[" then return parse_array(s, i) end
    if c == '"' then return parse_string(s, i) end
    if c == "t" or c == "f" or c == "n" then return parse_literal(s, i) end
    return parse_number(s, i)
end

function json.decode(s)
    if type(s) ~= "string" then return nil end
    local ok, val = pcall(parse_value, s, 1)
    if ok then return val end
    return nil
end

-- Sentinel value for explicit null
json.null = setmetatable({}, { __tostring = function() return "null" end })

return json
