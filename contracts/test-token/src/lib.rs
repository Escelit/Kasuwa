#![cfg_attr(target_family = "wasm", no_std)]

#[cfg(all(target_family = "wasm", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

#[test]
fn placeholder() {}
