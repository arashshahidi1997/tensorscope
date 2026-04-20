-- Pandoc include filter: expands `--8<-- "path.md"` and `{% include-markdown "path.md" %}` markers.
-- Works with repo-root-relative paths so MkDocs and Pandoc share content.

local utils = require("pandoc.utils")

local function open_file(path)
  local f = io.open(path, "r")
  if f then
    return f, path
  end
  return nil, path
end

local function read_file(path)
  local f, resolved = open_file(path)
  if not f and not path:match("^docs/") then
    f, resolved = open_file("docs/" .. path)
  end

  if not f then
    io.stderr:write(string.format("[include.lua] unable to open %s\n", path))
    return ""
  end
  local content = f:read("*all")
  f:close()
  return content
end

local function expand_include(path)
  local text = read_file(path)
  if text == "" then
    return {}
  end
  return pandoc.read(text, "markdown").blocks
end

local function normalize_marker(text)
  return text
    :gsub("\u{2013}", "--")
    :gsub("\u{2014}", "--")
    :gsub("\u{201C}", "\"")
    :gsub("\u{201D}", "\"")
    :gsub("\u{00AB}", "\"")
    :gsub("\u{00BB}", "\"")
    :gsub("\u{2018}", "'")
    :gsub("\u{2019}", "'")
end

local function stringify_inlines(inlines)
  local buf = {}
  for i = 1, #inlines do
    buf[#buf + 1] = utils.stringify(inlines[i])
  end
  return table.concat(buf, "")
end

local function extract_include_path(text)
  local normalized = normalize_marker(text):gsub("^%s+", ""):gsub("%s+$", "")
  local path = normalized:match("^%-%-8<%-%-%s+\"(.-)\"$")
  if path then
    return path
  end

  local quote, matched = normalized:match("^%{%s*%%%s*include%-markdown%s+([\"'])(.-)%1%s*%%}%s*$")
  if matched then
    return matched
  end

  return nil
end

function Para(el)
  if #el.content == 0 then
    return nil
  end

  local text = stringify_inlines(el.content)
  local path = extract_include_path(text)
  if not path or path == "" then
    return nil
  end
  return expand_include(path)
end

local function ensure_md_extension(path)
  if path:match("%.md$") then
    return path
  end
  return path .. ".md"
end

local function derive_label(target)
  local base = target
  base = base:gsub("%.md$", "")
  base = base:match("([^/]+)$") or base
  base = base:gsub("-", " ")
  if #base > 0 then
    base = base:sub(1, 1):upper() .. base:sub(2)
  end
  return base
end

function Str(el)
  local target = el.text:match("^%[%[(.-)%]%]$")
  if not target then
    return nil
  end

  -- Hide wikilinks in Pandoc output (web build still uses them directly).
  return {}
end
