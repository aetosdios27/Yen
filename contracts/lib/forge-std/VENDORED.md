# forge-std

Vendored `src/`, `LICENSE-APACHE`, and `LICENSE-MIT` from
[forge-std v1.11.0](https://github.com/foundry-rs/forge-std/tree/8e40513d678f392f398620b3ef2b418648b33e89),
commit `8e40513d678f392f398620b3ef2b418648b33e89`.

Files are unmodified. Tests and deployment scripts use this library; the deployed
RootRegistry has no library dependency. Vendoring avoids submodule initialization
and network dependency resolution in frozen CI. Preserve both upstream licenses.
