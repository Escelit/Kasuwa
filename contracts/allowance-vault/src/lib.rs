#![no_std]

pub mod storage;
pub mod types;
pub mod verify;

use soroban_sdk::contract;

#[contract]
pub struct AllowanceVault;

#[cfg(test)]
mod test;
