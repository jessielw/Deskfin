local mp = require 'mp'
local assdraw = require 'mp.assdraw'
local utils = require 'mp.utils'

local POINTER_CLICK_BINDING = 'jellyfin-dc-overlay-click'
local BUTTON_KEY_BINDING = 'jellyfin-dc-skip-enter'
local SHOW_DURATION = 0.18
local HIDE_DURATION = 0.14
local NAV_IDLE_OPACITY = 0.22
local NAV_HIDE_DELAY = 2.5
local NAV_FADE_DURATION = 0.16

local overlay = mp.create_osd_overlay('ass-events')
overlay.z = 1000

local segments = {}
local active_segment = nil
local displayed_segment = nil
local skipped_segments = {}
local last_position = nil

local button_bounds = nil
local button_hovered = false
local click_binding_active = false
local click_action = nil
local keyboard_binding_active = false

local file_active = false
local navigation_available = {
    previous = false,
    next = false,
}
local navigation_bounds = {}
local navigation_hovered = nil
local navigation_visibility = 0
local navigation_hide_timer = nil
local navigation_animation_timer = nil
local navigation_animation_started = 0
local navigation_animation_duration = 0
local navigation_animation_from = 0
local navigation_animation_to = 0

local visibility = 0
local animation_timer = nil
local animation_started = 0
local animation_duration = 0
local animation_from = 0
local animation_to = 0

local skip_current_segment
local render_overlay

local function send_control(action, label)
    mp.osd_message(label, 1)
    mp.commandv('script-message', 'jellyfin-dc-control', action)
end

local function set_click_action(action)
    click_action = action
    local enabled = action ~= nil
    if enabled == click_binding_active then return end
    click_binding_active = enabled
    if enabled then
        mp.add_forced_key_binding('MBTN_LEFT', POINTER_CLICK_BINDING, function()
            if click_action == 'skip' then
                skip_current_segment()
            elseif click_action == 'next' then
                send_control('next', 'Next item')
            elseif click_action == 'previous' then
                send_control('previous', 'Previous item')
            end
        end)
    else
        mp.remove_key_binding(POINTER_CLICK_BINDING)
    end
end

local function set_keyboard_binding(enabled)
    if enabled == keyboard_binding_active then return end
    keyboard_binding_active = enabled
    if enabled then
        mp.add_key_binding('ENTER', BUTTON_KEY_BINDING, function()
            skip_current_segment()
        end)
    else
        mp.remove_key_binding(BUTTON_KEY_BINDING)
    end
end

local function point_is_in_bounds(mouse, bounds)
    return bounds
        and type(mouse) == 'table'
        and mouse.hover == true
        and type(mouse.x) == 'number'
        and type(mouse.y) == 'number'
        and mouse.x >= bounds.x1
        and mouse.x <= bounds.x2
        and mouse.y >= bounds.y1
        and mouse.y <= bounds.y2
end

local function combined_alpha(base_alpha, opacity)
    local fade_alpha = 255 * (1 - (opacity or visibility))
    return math.floor(
        255
        - ((1 - base_alpha / 255) * (1 - fade_alpha / 255) * 255)
        + 0.5
    )
end

local function color_style(color, base_alpha, opacity)
    return string.format(
        '{\\blur0\\bord0\\shad0\\1c%s\\1a&H%02X&}',
        color,
        combined_alpha(base_alpha, opacity)
    )
end

local function append_rounded_rect(
    ass,
    begin_event,
    x,
    y,
    width,
    height,
    radius,
    color,
    alpha,
    opacity
)
    begin_event()
    ass:pos(x, y)
    ass:an(7)
    ass:append(color_style(color, alpha, opacity))
    ass:draw_start()
    ass:round_rect_cw(0, 0, width, height, radius)
    ass:draw_stop()
end

local function clear_skip_overlay()
    button_bounds = nil
    button_hovered = false
    if click_action == 'skip' then set_click_action(nil) end
    set_keyboard_binding(false)
end

render_overlay = function()
    local dimensions = mp.get_property_native('osd-dimensions')
    if not dimensions
        or type(dimensions.w) ~= 'number'
        or type(dimensions.h) ~= 'number'
        or dimensions.w <= 0
        or dimensions.h <= 0 then
        clear_skip_overlay()
        navigation_bounds = {}
        navigation_hovered = nil
        set_click_action(nil)
        overlay:remove()
        return
    end

    local scale = math.max(0.75, math.min(1.5, dimensions.h / 720))
    local side_margin = math.floor(38 * scale)
    local bottom_margin = math.floor(126 * scale)
    local right_video_margin = tonumber(dimensions.mr) or 0
    local bottom_video_margin = tonumber(dimensions.mb) or 0

    local ass = assdraw.ass_new()
    local has_event = false
    local function begin_event()
        if has_event then ass:new_event() end
        has_event = true
    end

    local skip_x = nil
    if displayed_segment and active_segment then
        local width = math.floor(84 * scale)
        local height = math.floor(40 * scale)
        local radius = math.floor(height / 2)
        local x = math.max(
            side_margin,
            math.floor(
                dimensions.w - right_video_margin - side_margin - width
            )
        )
        local y = math.max(
            side_margin,
            math.floor(
                dimensions.h
                - bottom_video_margin
                - bottom_margin
                - height
            )
        )
        skip_x = x

        button_bounds = {
            x1 = x,
            y1 = y,
            x2 = x + width,
            y2 = y + height,
        }
        local mouse = mp.get_property_native('mouse-pos')
        button_hovered = active_segment ~= nil
            and point_is_in_bounds(mouse, button_bounds) == true
        set_keyboard_binding(active_segment ~= nil)

        if visibility > 0 then
            local skip_opacity = visibility
                * (button_hovered and 1 or NAV_IDLE_OPACITY)
            append_rounded_rect(
                ass,
                begin_event,
                x,
                y,
                width,
                height,
                radius,
                button_hovered and '&HD779C8&' or '&H211A25&',
                button_hovered and 10 or 42,
                skip_opacity
            )

            local center_y = y + math.floor(height / 2)
            begin_event()
            ass:pos(x + math.floor(width / 2), center_y)
            ass:an(5)
            ass:append(string.format(
                '{\\blur0\\bord0\\shad0\\1c&HFFFFFF&'
                .. '\\1a&H%02X&\\fs%d\\b1}',
                combined_alpha(
                    button_hovered and 0 or 20,
                    skip_opacity
                ),
                math.floor(16 * scale)
            ))
            ass:append('Skip')
        end
    else
        clear_skip_overlay()
    end

    navigation_bounds = {}
    local navigation_actions = {}
    if navigation_available.previous then
        table.insert(navigation_actions, 'previous')
    end
    if navigation_available.next then
        table.insert(navigation_actions, 'next')
    end
    if file_active and #navigation_actions > 0 then
        local nav_size = math.floor(40 * scale)
        local nav_gap = math.floor(8 * scale)
        local skip_gap = math.floor(12 * scale)
        local nav_y = math.max(
            side_margin,
            math.floor(
                dimensions.h
                - bottom_video_margin
                - bottom_margin
                - nav_size
            )
        )
        local next_x
        if skip_x then
            next_x = skip_x - skip_gap - nav_size
        else
            next_x = math.floor(
                dimensions.w
                - right_video_margin
                - side_margin
                - nav_size
            )
        end
        next_x = math.max(side_margin, next_x)
        for index, action in ipairs(navigation_actions) do
            local action_x = next_x
                - (#navigation_actions - index) * (nav_size + nav_gap)
            navigation_bounds[action] = {
                x1 = action_x,
                y1 = nav_y,
                x2 = action_x + nav_size,
                y2 = nav_y + nav_size,
            }
        end

        local mouse = mp.get_property_native('mouse-pos')
        if point_is_in_bounds(mouse, navigation_bounds.previous) then
            navigation_hovered = 'previous'
        elseif point_is_in_bounds(mouse, navigation_bounds.next) then
            navigation_hovered = 'next'
        else
            navigation_hovered = nil
        end

        if navigation_visibility > 0 then
            for _, action in ipairs(navigation_actions) do
                local bounds = navigation_bounds[action]
                local hovered = navigation_hovered == action
                local width = bounds.x2 - bounds.x1
                local height = bounds.y2 - bounds.y1
                local radius = math.floor(width / 2)
                append_rounded_rect(
                    ass,
                    begin_event,
                    bounds.x1,
                    bounds.y1,
                    width,
                    height,
                    radius,
                    hovered and '&HD779C8&' or '&H211A25&',
                    hovered and 10 or 42,
                    navigation_visibility
                )

                local center_x = bounds.x1 + math.floor(width / 2)
                local center_y = bounds.y1 + math.floor(height / 2)
                local direction = action == 'next' and 1 or -1
                local icon_scale = scale

                begin_event()
                ass:pos(0, 0)
                ass:an(7)
                ass:append(color_style(
                    '&HFFFFFF&',
                    hovered and 0 or 20,
                    navigation_visibility
                ))
                ass:draw_start()
                ass:move_to(
                    center_x - direction * math.floor(7 * icon_scale),
                    center_y - math.floor(8 * icon_scale)
                )
                ass:line_to(
                    center_x + direction * math.floor(5 * icon_scale),
                    center_y
                )
                ass:line_to(
                    center_x - direction * math.floor(7 * icon_scale),
                    center_y + math.floor(8 * icon_scale)
                )
                ass:draw_stop()

                local bar_width = math.max(2, math.floor(2 * icon_scale))
                local bar_x
                if action == 'next' then
                    bar_x = center_x + math.floor(7 * icon_scale)
                else
                    bar_x = center_x - math.floor(7 * icon_scale) - bar_width
                end
                append_rounded_rect(
                    ass,
                    begin_event,
                    bar_x,
                    center_y - math.floor(8 * icon_scale),
                    bar_width,
                    math.floor(16 * icon_scale),
                    math.max(1, math.floor(icon_scale)),
                    '&HFFFFFF&',
                    hovered and 0 or 20,
                    navigation_visibility
                )
            end
        end
    else
        navigation_hovered = nil
    end

    if button_hovered and active_segment then
        set_click_action('skip')
    elseif navigation_hovered and navigation_visibility > 0 then
        set_click_action(navigation_hovered)
    else
        set_click_action(nil)
    end

    overlay.res_x = dimensions.w
    overlay.res_y = dimensions.h
    if has_event then
        overlay.data = ass.text
        overlay:update()
    else
        overlay:remove()
    end
end

local function stop_animation()
    if not animation_timer then return end
    animation_timer:kill()
    animation_timer = nil
end

local function ease_in_out_cubic(value)
    if value < 0.5 then
        return 4 * value * value * value
    end
    return 1 - ((-2 * value + 2) ^ 3) / 2
end

local function finish_animation()
    visibility = animation_to
    stop_animation()
    if visibility <= 0 then
        displayed_segment = nil
        clear_skip_overlay()
    end
    render_overlay()
end

local function update_animation()
    local elapsed = mp.get_time() - animation_started
    local progress = math.min(1, elapsed / animation_duration)
    local eased = ease_in_out_cubic(progress)
    visibility = animation_from + (animation_to - animation_from) * eased
    render_overlay()
    if progress >= 1 then finish_animation() end
end

local function animate_to(target, duration)
    stop_animation()
    animation_from = visibility
    animation_to = target
    animation_started = mp.get_time()
    animation_duration = duration
    if math.abs(animation_from - animation_to) < 0.001 then
        finish_animation()
        return
    end
    animation_timer = mp.add_periodic_timer(1 / 60, update_animation)
    update_animation()
end

local function show_button(segment)
    displayed_segment = segment
    set_keyboard_binding(true)
    animate_to(1, SHOW_DURATION)
end

local function hide_button(immediate)
    if click_action == 'skip' then set_click_action(nil) end
    set_keyboard_binding(false)
    button_hovered = false
    if immediate then
        stop_animation()
        visibility = 0
        displayed_segment = nil
        clear_skip_overlay()
        render_overlay()
    elseif displayed_segment then
        animate_to(0, HIDE_DURATION)
    end
end

local function reset_segments()
    segments = {}
    active_segment = nil
    skipped_segments = {}
    last_position = nil
    hide_button(true)
end

local function set_segments(payload)
    reset_segments()
    if type(payload) ~= 'string' or payload == '' then return end

    local ok, decoded = pcall(utils.parse_json, payload)
    if not ok or type(decoded) ~= 'table' then return end

    for _, segment in ipairs(decoded) do
        if type(segment) == 'table'
            and type(segment.type) == 'string'
            and type(segment.startSeconds) == 'number'
            and type(segment.endSeconds) == 'number'
            and segment.startSeconds >= 0
            and segment.endSeconds > segment.startSeconds then
            table.insert(segments, {
                type = segment.type,
                start_seconds = segment.startSeconds,
                end_seconds = segment.endSeconds,
            })
        end
    end

    local position = mp.get_property_number('time-pos')
    if not position then return end
    last_position = position
    for index, segment in ipairs(segments) do
        if position >= segment.start_seconds
            and position < segment.end_seconds then
            active_segment = index
            show_button(segment)
            break
        end
    end
end

skip_current_segment = function()
    if not active_segment or skipped_segments[active_segment] then return end

    local index = active_segment
    local segment = segments[index]
    if not segment then return end

    skipped_segments[index] = true
    active_segment = nil
    hide_button(false)
    mp.commandv('seek', tostring(segment.end_seconds), 'absolute')
    local skipped_label = segment.type == 'Outro' and 'Credits' or segment.type
    mp.osd_message('Skipped ' .. skipped_label, 1)
end

local function update_segment(position)
    local current = nil
    if type(position) == 'number' then
        if last_position and position < last_position - 1 then
            for index, segment in ipairs(segments) do
                local rearm_before = math.max(
                    segment.start_seconds,
                    segment.end_seconds - 1
                )
                if skipped_segments[index] and position <= rearm_before then
                    skipped_segments[index] = nil
                end
            end
        end
        last_position = position
        for index, segment in ipairs(segments) do
            if not skipped_segments[index]
                and position >= segment.start_seconds
                and position < segment.end_seconds then
                current = index
                break
            end
        end
    end

    if current == active_segment then return end
    active_segment = current
    if current then
        show_button(segments[current])
    else
        hide_button(false)
    end
end

local function stop_navigation_hide_timer()
    if not navigation_hide_timer then return end
    navigation_hide_timer:kill()
    navigation_hide_timer = nil
end

local function stop_navigation_animation()
    if not navigation_animation_timer then return end
    navigation_animation_timer:kill()
    navigation_animation_timer = nil
end

local function finish_navigation_animation()
    navigation_visibility = navigation_animation_to
    stop_navigation_animation()
    render_overlay()
end

local function update_navigation_animation()
    local elapsed = mp.get_time() - navigation_animation_started
    local progress = math.min(
        1,
        elapsed / navigation_animation_duration
    )
    local eased = ease_in_out_cubic(progress)
    navigation_visibility = navigation_animation_from
        + (navigation_animation_to - navigation_animation_from) * eased
    render_overlay()
    if progress >= 1 then finish_navigation_animation() end
end

local function animate_navigation_to(target)
    if navigation_animation_timer
        and math.abs(navigation_animation_to - target) < 0.001 then
        return
    end
    stop_navigation_animation()
    navigation_animation_from = navigation_visibility
    navigation_animation_to = target
    navigation_animation_started = mp.get_time()
    navigation_animation_duration = NAV_FADE_DURATION
    if math.abs(navigation_animation_from - target) < 0.001 then
        finish_navigation_animation()
        return
    end
    navigation_animation_timer = mp.add_periodic_timer(
        1 / 60,
        update_navigation_animation
    )
    update_navigation_animation()
end

local function schedule_navigation_hide()
    stop_navigation_hide_timer()
    navigation_hide_timer = mp.add_timeout(NAV_HIDE_DELAY, function()
        navigation_hide_timer = nil
        if not navigation_hovered then animate_navigation_to(0) end
    end)
end

local function show_navigation(hovered)
    if not file_active
        or not (navigation_available.previous or navigation_available.next) then
        return
    end
    stop_navigation_hide_timer()
    animate_navigation_to(hovered and 1 or NAV_IDLE_OPACITY)
    if not hovered then schedule_navigation_hide() end
end

local function reset_navigation()
    file_active = false
    navigation_available.previous = false
    navigation_available.next = false
    navigation_hovered = nil
    navigation_bounds = {}
    navigation_visibility = 0
    stop_navigation_hide_timer()
    stop_navigation_animation()
    if click_action == 'next' or click_action == 'previous' then
        set_click_action(nil)
    end
    render_overlay()
end

local function set_navigation(payload)
    navigation_available.previous = false
    navigation_available.next = false
    if type(payload) == 'string' and payload ~= '' then
        local ok, decoded = pcall(utils.parse_json, payload)
        if ok and type(decoded) == 'table' then
            navigation_available.previous = decoded.previous == true
            navigation_available.next = decoded.next == true
        end
    end

    navigation_hovered = nil
    navigation_bounds = {}
    stop_navigation_hide_timer()
    stop_navigation_animation()
    navigation_visibility = 0
    if click_action == 'next' or click_action == 'previous' then
        set_click_action(nil)
    end
    render_overlay()
    if navigation_available.previous or navigation_available.next then
        show_navigation(false)
    end
end

local function update_hover(_, mouse)
    local previous_skip_hovered = button_hovered
    local previous_navigation_hovered = navigation_hovered

    button_hovered = active_segment ~= nil
        and point_is_in_bounds(mouse, button_bounds) == true
    if point_is_in_bounds(mouse, navigation_bounds.previous) then
        navigation_hovered = 'previous'
    elseif point_is_in_bounds(mouse, navigation_bounds.next) then
        navigation_hovered = 'next'
    else
        navigation_hovered = nil
    end

    if file_active then
        if navigation_hovered then
            show_navigation(true)
        elseif type(mouse) == 'table' and mouse.hover == true then
            show_navigation(false)
        else
            stop_navigation_hide_timer()
            animate_navigation_to(0)
        end
    end

    if previous_skip_hovered ~= button_hovered
        or previous_navigation_hovered ~= navigation_hovered then
        render_overlay()
    end
end

mp.register_event('start-file', function()
    reset_navigation()
    reset_segments()
end)
mp.register_event('file-loaded', function()
    file_active = true
    render_overlay()
    show_navigation(navigation_hovered ~= nil)
end)
mp.register_event('end-file', function()
    reset_navigation()
    reset_segments()
end)
mp.register_event('shutdown', function()
    reset_navigation()
    reset_segments()
end)
mp.register_script_message('jellyfin-dc-segments', set_segments)
mp.register_script_message('jellyfin-dc-navigation', set_navigation)
mp.register_script_message('jellyfin-dc-skip', function()
    skip_current_segment()
end)
mp.add_key_binding('Ctrl+Shift+i', 'jellyfin-dc-skip-fallback', function()
    skip_current_segment()
end)
mp.observe_property('time-pos', 'number', function(_, value)
    update_segment(value)
end)
mp.observe_property('mouse-pos', 'native', update_hover)
mp.observe_property('osd-dimensions', 'native', function()
    if displayed_segment or file_active then render_overlay() end
end)

mp.add_forced_key_binding('>', 'next', function()
    if navigation_available.next then
        send_control('next', 'Next item')
    end
end)

mp.add_forced_key_binding('<', 'previous', function()
    if navigation_available.previous then
        send_control('previous', 'Previous item')
    end
end)
