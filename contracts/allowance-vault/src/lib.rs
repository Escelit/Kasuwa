#![cfg_attr(target_family = "wasm", no_std)]

pub mod storage;
pub mod types;
pub mod verify;

#[cfg(test)]
mod test;

#[cfg(all(target_family = "wasm", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}
