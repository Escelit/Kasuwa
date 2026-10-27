// KasuwaKeyModule+Bridge.m
// Exposes KasuwaKeyModule to React Native's ObjC bridge.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(KasuwaKeyModule, NSObject)

RCT_EXTERN_METHOD(generate:(NSString *)alias
                  requireBiometric:(BOOL)requireBiometric
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sign:(NSString *)alias
                  digest:(NSArray *)digest
                  prompt:(NSString *)prompt
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(exists:(NSString *)alias
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(delete:(NSString *)alias
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
