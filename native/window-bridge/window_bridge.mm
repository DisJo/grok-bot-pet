#include <node_api.h>
#include <cmath>
#include <cstring>
#import <ApplicationServices/ApplicationServices.h>
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

namespace {

napi_value Boolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

napi_value Null(napi_env env) {
  napi_value result;
  napi_get_null(env, &result);
  return result;
}

bool Number(napi_env env, napi_value value, double* output) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_number) return false;
  if (napi_get_value_double(env, value, output) != napi_ok) return false;
  return std::isfinite(*output);
}

bool WindowFromHandle(napi_env env, napi_value value, NSWindow** output) {
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer) return false;
  void* bytes = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &bytes, &length) != napi_ok || !bytes || length < sizeof(void*)) return false;
  void* pointer = nullptr;
  std::memcpy(&pointer, bytes, sizeof(pointer));
  if (!pointer) return false;
  NSView* view = (__bridge NSView*)pointer;
  NSWindow* window = view.window;
  if (!window) return false;
  *output = window;
  return true;
}

void OnMainThread(dispatch_block_t block) {
  if (NSThread.isMainThread) block();
  else dispatch_sync(dispatch_get_main_queue(), block);
}

char kUnconstrainedWindowKey;
Class constrainedWindowClass = Nil;
IMP originalConstrainFrame = nullptr;

NSRect ConstrainFrameRect(id instance, SEL selector, NSRect frame, NSScreen* screen) {
  if (objc_getAssociatedObject(instance, &kUnconstrainedWindowKey)) return frame;
  if (!originalConstrainFrame) return frame;
  using Function = NSRect (*)(id, SEL, NSRect, NSScreen*);
  return reinterpret_cast<Function>(originalConstrainFrame)(instance, selector, frame, screen);
}

bool EnsureUnconstrainedWindow(NSWindow* window) {
  @synchronized([NSWindow class]) {
    Class currentClass = object_getClass(window);
    if (!constrainedWindowClass) {
      SEL selector = @selector(constrainFrameRect:toScreen:);
      Method method = class_getInstanceMethod(currentClass, selector);
      if (!method) return false;
      const char* typeEncoding = method_getTypeEncoding(method);
      IMP inheritedOrOriginal = method_getImplementation(method);
      if (!typeEncoding || !inheritedOrOriginal) return false;
      IMP replaced = class_replaceMethod(
        currentClass,
        selector,
        reinterpret_cast<IMP>(ConstrainFrameRect),
        typeEncoding
      );
      originalConstrainFrame = replaced ?: inheritedOrOriginal;
      constrainedWindowClass = currentClass;
    }
    if (currentClass != constrainedWindowClass) return false;
    objc_setAssociatedObject(window, &kUnconstrainedWindowKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return objc_getAssociatedObject(window, &kUnconstrainedWindowKey) != nil;
  }
}

napi_value OffsetWindow(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 3) return Boolean(env, false);
  NSWindow* window = nil;
  double dx = 0;
  double dy = 0;
  if (!WindowFromHandle(env, argv[0], &window) || !Number(env, argv[1], &dx) || !Number(env, argv[2], &dy)) {
    return Boolean(env, false);
  }
  __block bool moved = false;
  OnMainThread(^{
    if (!EnsureUnconstrainedWindow(window)) return;
    NSPoint origin = window.frame.origin;
    origin.x += dx;
    origin.y -= dy;
    [window setFrameOrigin:origin];
    moved = true;
  });
  return Boolean(env, moved);
}

napi_value SetAlwaysOnTop(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) return Boolean(env, false);
  NSWindow* window = nil;
  bool enabled = false;
  if (!WindowFromHandle(env, argv[0], &window) || napi_get_value_bool(env, argv[1], &enabled) != napi_ok) {
    return Boolean(env, false);
  }
  OnMainThread(^{
    [window setLevel:enabled ? NSScreenSaverWindowLevel + 1 : NSNormalWindowLevel];
    NSWindowCollectionBehavior behavior = window.collectionBehavior;
    behavior |= NSWindowCollectionBehaviorCanJoinAllSpaces;
    behavior |= NSWindowCollectionBehaviorFullScreenAuxiliary;
    [window setCollectionBehavior:behavior];
  });
  return Boolean(env, true);
}

void SetNumber(napi_env env, napi_value object, const char* name, double value) {
  napi_value number;
  napi_create_double(env, value, &number);
  napi_set_named_property(env, object, name, number);
}

napi_value GetWindowFrame(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  NSWindow* window = nil;
  if (argc != 1 || !WindowFromHandle(env, argv[0], &window)) {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
  }
  __block NSRect frame;
  __block CGFloat primaryScreenTop = 0;
  OnMainThread(^{
    frame = window.frame;
    NSScreen* primaryScreen = NSScreen.screens.firstObject;
    primaryScreenTop = primaryScreen ? NSMaxY(primaryScreen.frame) : NSMaxY(frame);
  });
  napi_value result;
  napi_create_object(env, &result);
  SetNumber(env, result, "x", frame.origin.x);
  SetNumber(env, result, "y", primaryScreenTop - NSMaxY(frame));
  SetNumber(env, result, "width", frame.size.width);
  SetNumber(env, result, "height", frame.size.height);
  return result;
}

bool AccessibilityTrusted(bool promptForPermission) {
  if (!promptForPermission) return AXIsProcessTrusted();
  NSDictionary* options = @{(__bridge NSString*)kAXTrustedCheckOptionPrompt: @YES};
  return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
}

NSString* CopyStringAttribute(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef value = nullptr;
  AXError error = AXUIElementCopyAttributeValue(element, attribute, &value);
  if (error != kAXErrorSuccess || !value) {
    if (value) CFRelease(value);
    return nil;
  }
  NSString* string = CFGetTypeID(value) == CFStringGetTypeID() ? [(__bridge NSString*)value copy] : nil;
  CFRelease(value);
  return string;
}

bool BooleanAttribute(AXUIElementRef element, CFStringRef attribute, bool fallback) {
  CFTypeRef value = nullptr;
  AXError error = AXUIElementCopyAttributeValue(element, attribute, &value);
  if (error != kAXErrorSuccess || !value) {
    if (value) CFRelease(value);
    return fallback;
  }
  bool result = CFGetTypeID(value) == CFBooleanGetTypeID() ? CFBooleanGetValue((CFBooleanRef)value) : fallback;
  CFRelease(value);
  return result;
}

bool MatchesLabel(NSString* value, bool affirmative) {
  if (!value) return false;
  NSString* label = [[value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] lowercaseString];
  if (affirmative) {
    return [label isEqualToString:@"allow"]
      || [label isEqualToString:@"allow once"]
      || [label isEqualToString:@"允许"]
      || [label isEqualToString:@"仅允许一次"]
      || [label isEqualToString:@"继续"];
  }
  return [label isEqualToString:@"deny"]
    || [label isEqualToString:@"cancel"]
    || [label isEqualToString:@"拒绝"]
    || [label isEqualToString:@"取消"];
}

struct ApprovalSignals {
  bool affirmative = false;
  bool rejecting = false;
  bool visiblePanel = false;
};

ApprovalSignals InspectApprovalSubtree(AXUIElementRef element, size_t depth, size_t* visited, bool ancestorVisible) {
  ApprovalSignals signals;
  if (!element || depth > 12 || *visited >= 1500) return signals;
  *visited += 1;

  NSString* role = CopyStringAttribute(element, kAXRoleAttribute);
  NSString* subrole = CopyStringAttribute(element, kAXSubroleAttribute);
  NSString* title = CopyStringAttribute(element, kAXTitleAttribute);
  NSString* value = CopyStringAttribute(element, kAXValueAttribute);
  bool hidden = BooleanAttribute(element, kAXHiddenAttribute, false);
  bool enabled = BooleanAttribute(element, kAXEnabledAttribute, false);
  bool visible = ancestorVisible && !hidden;

  bool isDecisionControl = [role isEqualToString:(__bridge NSString*)kAXButtonRole] && enabled && visible;
  if (isDecisionControl) {
    signals.affirmative = MatchesLabel(title, true) || MatchesLabel(value, true);
    signals.rejecting = MatchesLabel(title, false) || MatchesLabel(value, false);
  }

  CFTypeRef childrenValue = nullptr;
  AXError childrenError = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &childrenValue);
  if (childrenError == kAXErrorSuccess && childrenValue) {
    if (CFGetTypeID(childrenValue) == CFArrayGetTypeID()) {
      CFArrayRef children = (CFArrayRef)childrenValue;
      CFIndex count = CFArrayGetCount(children);
      for (CFIndex index = 0; index < count && *visited < 1500; ++index) {
        CFTypeRef child = CFArrayGetValueAtIndex(children, index);
        if (!child || CFGetTypeID(child) != AXUIElementGetTypeID()) continue;
        ApprovalSignals childSignals = InspectApprovalSubtree((AXUIElementRef)child, depth + 1, visited, visible);
        signals.affirmative = signals.affirmative || childSignals.affirmative;
        signals.rejecting = signals.rejecting || childSignals.rejecting;
        signals.visiblePanel = signals.visiblePanel || childSignals.visiblePanel;
      }
    }
  }
  if (childrenValue) CFRelease(childrenValue);

  bool isContainer = [role isEqualToString:(__bridge NSString*)kAXSheetRole]
    || [role isEqualToString:(__bridge NSString*)kAXGroupRole]
    || [subrole isEqualToString:(__bridge NSString*)kAXDialogSubrole]
    || [subrole isEqualToString:(__bridge NSString*)kAXSystemDialogSubrole];
  if (isContainer && visible && signals.affirmative && signals.rejecting) signals.visiblePanel = true;
  return signals;
}

enum class ApprovalQueryResult { unavailable, notVisible, visible };

ApprovalQueryResult ApplicationApprovalPanel(NSRunningApplication* application) {
  AXUIElementRef applicationElement = AXUIElementCreateApplication(application.processIdentifier);
  if (!applicationElement) return ApprovalQueryResult::unavailable;

  bool visible = false;
  size_t visited = 0;
  CFTypeRef windowsValue = nullptr;
  AXError error = AXUIElementCopyAttributeValue(applicationElement, kAXWindowsAttribute, &windowsValue);
  if (error != kAXErrorSuccess || !windowsValue || CFGetTypeID(windowsValue) != CFArrayGetTypeID()) {
    if (windowsValue) CFRelease(windowsValue);
    CFRelease(applicationElement);
    return ApprovalQueryResult::unavailable;
  }

  CFArrayRef windows = (CFArrayRef)windowsValue;
  CFIndex count = CFArrayGetCount(windows);
  for (CFIndex index = 0; index < count && visited < 1500 && !visible; ++index) {
    CFTypeRef window = CFArrayGetValueAtIndex(windows, index);
    if (!window || CFGetTypeID(window) != AXUIElementGetTypeID()) continue;
    visible = InspectApprovalSubtree((AXUIElementRef)window, 0, &visited, true).visiblePanel;
  }
  CFRelease(windowsValue);
  CFRelease(applicationElement);
  return visible ? ApprovalQueryResult::visible : ApprovalQueryResult::notVisible;
}

napi_value CodexApprovalVisible(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc > 1) return Null(env);

  bool promptForPermission = false;
  if (argc == 1 && napi_get_value_bool(env, argv[0], &promptForPermission) != napi_ok) return Null(env);
  if (!AccessibilityTrusted(promptForPermission)) return Null(env);

  @autoreleasepool {
    @try {
      bool unavailable = false;
      for (NSRunningApplication* application in NSWorkspace.sharedWorkspace.runningApplications) {
        if (![application.bundleIdentifier isEqualToString:@"com.openai.codex"]) continue;
        ApprovalQueryResult result = ApplicationApprovalPanel(application);
        if (result == ApprovalQueryResult::visible) return Boolean(env, true);
        unavailable = unavailable || result == ApprovalQueryResult::unavailable;
      }
      return unavailable ? Null(env) : Boolean(env, false);
    } @catch (NSException*) {
      return Null(env);
    }
  }
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"offsetWindow", nullptr, OffsetWindow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setAlwaysOnTop", nullptr, SetAlwaysOnTop, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getWindowFrame", nullptr, GetWindowFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"codexApprovalVisible", nullptr, CodexApprovalVisible, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(window_bridge, Init)
