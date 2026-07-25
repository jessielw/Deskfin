local mp = require 'mp'

local function send_control(action, label)
    mp.osd_message(label, 1)
    mp.commandv('script-message', 'jellyfin-dc-control', action)
end

mp.add_forced_key_binding('>', 'next', function()
    send_control('next', 'Next item')
end)

mp.add_forced_key_binding('<', 'previous', function()
    send_control('previous', 'Previous item')
end)
