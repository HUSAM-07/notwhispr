import AppKit
import ApplicationServices
import Foundation

struct PermissionState: Codable {
    let microphone: String
    let accessibility: Bool
    let inputMonitoring: Bool
    let postEvents: Bool
}

struct FocusState: Codable {
    let canPaste: Bool
    let role: String?
    let appName: String?
    let bundleIdentifier: String?
    let processIdentifier: Int32?
}

struct OkState: Codable {
    let ok: Bool
}

struct EventMessage: Codable {
    let type: String
    let message: String?
    let terminalCommandMode: Bool?
}

private var fnIsDown = false
private var terminalCommandModeIsDown = false

func emitJSON<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = []

    guard let data = try? encoder.encode(value) else {
        return
    }

    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func inputMonitoringGranted() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightListenEventAccess()
    }

    return true
}

func postEventsGranted() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightPostEventAccess()
    }

    return true
}

func buildPermissionState() -> PermissionState {
    PermissionState(
        microphone: "unknown",
        accessibility: AXIsProcessTrusted(),
        inputMonitoring: inputMonitoringGranted(),
        postEvents: postEventsGranted()
    )
}

func requestPermissions() -> PermissionState {
    let options = [
        kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true
    ] as CFDictionary

    _ = AXIsProcessTrustedWithOptions(options)

    if #available(macOS 10.15, *) {
        _ = CGRequestListenEventAccess()
        _ = CGRequestPostEventAccess()
    }

    return buildPermissionState()
}

func currentFocus() -> FocusState {
    let frontmostApplication = NSWorkspace.shared.frontmostApplication
    let appName = frontmostApplication?.localizedName
    let bundleIdentifier = frontmostApplication?.bundleIdentifier
    let processIdentifier = frontmostApplication.map { Int32($0.processIdentifier) }
    let systemWide = AXUIElementCreateSystemWide()
    var focusedRef: CFTypeRef?

    let focusedStatus = AXUIElementCopyAttributeValue(
        systemWide,
        kAXFocusedUIElementAttribute as CFString,
        &focusedRef
    )

    guard focusedStatus == .success, let focusedRef else {
        return FocusState(
            canPaste: false,
            role: nil,
            appName: appName,
            bundleIdentifier: bundleIdentifier,
            processIdentifier: processIdentifier
        )
    }

    let focused = unsafeBitCast(focusedRef, to: AXUIElement.self)

    var roleRef: CFTypeRef?
    let roleStatus = AXUIElementCopyAttributeValue(
        focused,
        kAXRoleAttribute as CFString,
        &roleRef
    )

    let role = roleStatus == .success ? (roleRef as? String) : nil
    let knownTextRoles: Set<String> = [
        kAXTextFieldRole as String,
        kAXTextAreaRole as String,
        "AXSearchField",
        kAXComboBoxRole as String,
        "AXWebArea"
    ]

    var valueSettable = DarwinBoolean(false)
    let valueStatus = AXUIElementIsAttributeSettable(
        focused,
        kAXValueAttribute as CFString,
        &valueSettable
    )

    var selectedTextRangeRef: CFTypeRef?
    let selectedTextRangeStatus = AXUIElementCopyAttributeValue(
        focused,
        kAXSelectedTextRangeAttribute as CFString,
        &selectedTextRangeRef
    )

    let canPaste =
        knownTextRoles.contains(role ?? "") ||
        (valueStatus == .success && valueSettable.boolValue) ||
        selectedTextRangeStatus == .success

    return FocusState(
        canPaste: canPaste,
        role: role,
        appName: appName,
        bundleIdentifier: bundleIdentifier,
        processIdentifier: processIdentifier
    )
}

func activateTargetApplication(bundleIdentifier: String?, processIdentifier: pid_t?) {
    var application: NSRunningApplication?

    if let processIdentifier, processIdentifier > 0 {
        application = NSRunningApplication(processIdentifier: processIdentifier)
    }

    if application == nil, let bundleIdentifier, !bundleIdentifier.isEmpty {
        application = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).first
    }

    application?.unhide()
    _ = application?.activate(options: [.activateIgnoringOtherApps])
    usleep(260_000)
}

func pasteClipboardContents(bundleIdentifier: String?, processIdentifier: pid_t?) -> Bool {
    guard postEventsGranted() else {
        return false
    }

    activateTargetApplication(bundleIdentifier: bundleIdentifier, processIdentifier: processIdentifier)

    let commandKeyCode: CGKeyCode = 55
    let keyCodeV: CGKeyCode = 9
    guard let source = CGEventSource(stateID: .combinedSessionState),
          let commandDown = CGEvent(keyboardEventSource: source, virtualKey: commandKeyCode, keyDown: true),
          let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCodeV, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCodeV, keyDown: false),
          let commandUp = CGEvent(keyboardEventSource: source, virtualKey: commandKeyCode, keyDown: false)
    else {
        return false
    }

    commandDown.flags = .maskCommand
    keyDown.flags = .maskCommand
    keyUp.flags = .maskCommand
    commandUp.flags = []
    commandDown.post(tap: .cghidEventTap)
    usleep(12_000)
    keyDown.post(tap: .cghidEventTap)
    keyUp.post(tap: .cghidEventTap)
    usleep(12_000)
    commandUp.post(tap: .cghidEventTap)

    return true
}

private func flagsChangedCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard type == .flagsChanged else {
        return Unmanaged.passUnretained(event)
    }

    let fnIsCurrentlyDown = event.flags.contains(.maskSecondaryFn)
    let terminalCommandModeIsCurrentlyDown = event.flags.contains(.maskCommand)

    if fnIsCurrentlyDown != fnIsDown {
        fnIsDown = fnIsCurrentlyDown
        terminalCommandModeIsDown = terminalCommandModeIsCurrentlyDown
        emitJSON(EventMessage(
            type: fnIsCurrentlyDown ? "fnDown" : "fnUp",
            message: nil,
            terminalCommandMode: terminalCommandModeIsCurrentlyDown
        ))
    } else if fnIsDown && terminalCommandModeIsCurrentlyDown != terminalCommandModeIsDown {
        terminalCommandModeIsDown = terminalCommandModeIsCurrentlyDown
        emitJSON(EventMessage(
            type: "modifierChanged",
            message: nil,
            terminalCommandMode: terminalCommandModeIsCurrentlyDown
        ))
    }

    return Unmanaged.passUnretained(event)
}

func listenForFnKey() -> Int32 {
    guard inputMonitoringGranted() else {
        emitJSON(EventMessage(type: "error", message: "Input Monitoring is not enabled for OpenWhisp.", terminalCommandMode: nil))
        return 1
    }

    let eventMask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: eventMask,
        callback: flagsChangedCallback,
        userInfo: nil
    ) else {
        emitJSON(EventMessage(type: "error", message: "OpenWhisp could not create the global Fn listener.", terminalCommandMode: nil))
        return 1
    }

    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    CFRunLoopRun()

    return 0
}

let arguments = CommandLine.arguments

guard arguments.count >= 2 else {
    emitJSON(EventMessage(type: "error", message: "No helper command was provided.", terminalCommandMode: nil))
    exit(1)
}

switch arguments[1] {
case "permissions":
    if arguments.count >= 3 && arguments[2] == "request" {
        emitJSON(requestPermissions())
    } else {
        emitJSON(buildPermissionState())
    }
case "focus":
    emitJSON(currentFocus())
case "paste":
    let bundleIdentifier = arguments.count >= 3 ? arguments[2] : nil
    let processIdentifier = arguments.count >= 4 ? Int32(arguments[3]) : nil
    emitJSON(OkState(ok: pasteClipboardContents(bundleIdentifier: bundleIdentifier, processIdentifier: processIdentifier)))
case "listen":
    exit(listenForFnKey())
default:
    emitJSON(EventMessage(type: "error", message: "Unknown helper command.", terminalCommandMode: nil))
    exit(1)
}
