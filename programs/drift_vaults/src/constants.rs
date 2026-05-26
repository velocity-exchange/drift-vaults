pub const TIME_FOR_LIQUIDATION: i64 = ONE_HOUR;

// TIME
pub const ONE_HOUR: i64 = 60 * 60;
pub const ONE_DAY: i64 = ONE_HOUR * 24;
pub const ONE_WEEK: i64 = ONE_DAY * 7;

pub mod admin {
    use anchor_lang::prelude::{pubkey, Pubkey};
    #[cfg(not(feature = "anchor-test"))]
    pub const ID: Pubkey = pubkey!("4wbNjWbj3kPDbyKnSq8SXVEtAJw4uzE8mJ2QwuK1BCYZ");

    #[cfg(feature = "anchor-test")]
    pub const ID: Pubkey = pubkey!("45HdJoU4aHmRzYBpd2zSvjvyfMUdzbrgBDkqLLcW45yA");
}
