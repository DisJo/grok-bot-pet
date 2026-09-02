#include <node_api.h>
#include <cmath>
#include <cstring>
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

namespace {

napi_value Boolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
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

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"offsetWindow", nullptr, OffsetWindow, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setAlwaysOnTop", nullptr, SetAlwaysOnTop, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getWindowFrame", nullptr, GetWindowFrame, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(window_bridge, Init)
