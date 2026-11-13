//! Link upgrades for Séance OS: binary messages, piggybacked ACKs, keep-alive and CALL tags.
//! All run on `Duo`, two real stations sharing simulated air.

use ggtf_core::duo::{Duo, ID_A};
use ggtf_core::link::{LinkEvent, LinkState, KIND_GGTP};
use ggtf_core::station::StationEvent;

fn connected(d: &Duo) -> bool {
    d.st[0].link.state() == LinkState::Connected && d.st[1].link.state() == LinkState::Connected
}

fn connect(d: &mut Duo) {
    d.connect();
    assert!(d.run_until(120_000.0, connected), "never connected: a={:?} b={:?}", d.st[0].link.state(), d.st[1].link.state());
}

fn received(ev: &[(usize, StationEvent)], side: usize) -> Vec<(u8, Vec<u8>)> {
    ev.iter()
        .filter_map(|(s, e)| match e {
            StationEvent::Link(LinkEvent::MsgReceived { kind, data }) if *s == side => Some((*kind, data.clone())),
            _ => None,
        })
        .collect()
}

#[test]
fn five_kilobyte_binary_message_arrives_intact() {
    let mut d = Duo::new(1);
    d.noise = 0.01;
    connect(&mut d);
    let blob: Vec<u8> = (0..5000u32).map(|i| (i.wrapping_mul(2654435761) >> 11) as u8).collect();
    let t0 = d.now;
    let now = d.now;
    d.st[0].send_msg(KIND_GGTP, &blob, now).expect("send");
    let mut got = Vec::new();
    let ok = d.run_until(600_000.0, |d| {
        got = received(d.events(), 1);
        !got.is_empty()
    });
    assert!(ok, "5 KB message never arrived");
    assert_eq!(got[0], (KIND_GGTP, blob));
    let secs = (d.now - t0) / 1000.0;
    println!("5000 bytes in {secs:.1} s = {:.1} B/s, fragment {} B, profile {:?}", 5000.0 / secs, d.st[0].link.frag_size(), d.st[0].link.profile());
}

#[test]
fn reply_carries_the_ack() {
    let mut d = Duo::new(2);
    connect(&mut d);
    // Let the ACK owed for the pairing confirmation go out first.
    d.run_for(4000.0);
    d.take_events();
    let before = d.st[1].link.link_stats;
    let now = d.now;
    d.st[0].send_msg(KIND_GGTP, b"GET /page/vampire", now).unwrap();
    assert!(d.run_until(60_000.0, |d| !received(d.events(), 1).is_empty()), "request never arrived");
    // B answers right away, the way an app handler does.
    let now = d.now;
    d.st[1].send_msg(KIND_GGTP, b"2.05 the vampire page", now).unwrap();
    assert!(d.run_until(60_000.0, |d| !received(d.events(), 0).is_empty()), "reply never arrived");
    let after = d.st[1].link.link_stats;
    assert_eq!(after.acks_piggybacked - before.acks_piggybacked, 1, "the request's ACK should ride on the reply");
    assert_eq!(after.acks_sent, before.acks_sent, "no standalone ACK for the request");
}

#[test]
fn keepalive_holds_an_idle_link_and_notices_a_dead_one() {
    let mut d = Duo::new(3);
    connect(&mut d);
    d.st[0].link.set_keepalive(20_000.0);
    d.st[1].link.set_keepalive(20_000.0);
    d.run_for(240_000.0);
    assert!(connected(&d), "idle link dropped despite keep-alives");
    let pings = d.st[0].link.link_stats.pings + d.st[1].link.link_stats.pings;
    assert!(pings >= 4, "expected keep-alives, got {pings}");
    // B leaves the room.
    d.gone[1] = true;
    let ended = d.run_until(240_000.0, |d| d.st[0].link.state() == LinkState::Idle);
    assert!(ended, "A never noticed B left");
}

#[test]
fn call_tag_reaches_the_answerer() {
    let mut d = Duo::new(4);
    d.st[1].set_answer(false);
    let tag = [0xC0, 0xFF, 0xEE, 0x13, 0x37, 0x00, 0x42, 0x99];
    let now = d.now;
    d.st[0].call_tagged(now, &tag);
    let rang = d.run_until(20_000.0, |d| {
        d.events().iter().any(|(s, e)| *s == 1 && matches!(e, StationEvent::Link(LinkEvent::Incoming { from: ID_A, tag: t }) if t == &tag))
    });
    assert!(rang, "B didn't see the tag");
    let now = d.now;
    assert!(d.st[1].accept(now));
    assert_eq!(d.st[1].link.peer_tag(), &tag);
    assert!(d.run_until(120_000.0, connected));
}

#[test]
fn long_message_survives_noise_and_dropouts() {
    let mut d = Duo::new(5);
    d.noise = 0.05;
    connect(&mut d);
    d.loss = 0.01;
    let msg: Vec<u8> = "the spirits are restless tonight; ".repeat(60).into_bytes();
    let now = d.now;
    d.st[0].send_msg(KIND_GGTP, &msg, now).unwrap();
    let mut got = Vec::new();
    let ok = d.run_until(900_000.0, |d| {
        got = received(d.events(), 1);
        !got.is_empty()
    });
    assert!(ok, "message lost: a={:?}", d.st[0].link.state());
    assert_eq!(got[0].1, msg);
    println!("frag limit after dropouts: {}", d.st[0].link.link_stats.frag_limit);
}
