"""Exact source model registrations, with no inferred size aliases."""
import unittest
from portkit.config import register_profiles


class ProfileRegistrations(unittest.TestCase):
    def test_public_identifier_uses_explicit_medium_pfl(self):
        medium = {"variants": {"l": {"model": "styuuh01lam"}}}
        large = {"variants": {"l": {"model": "styuuh01lal"}}}
        profiles = {"styuuh01am": medium, "styuuh01al": large}
        mapping = register_profiles(profiles, "#profile\nSTYuuh01a STYuuh01am.pfl\nstyuuh01al styuuh01al.pfl")
        self.assertIs(profiles["styuuh01a"], medium)
        self.assertIs(profiles["styuuh01al"], large)
        self.assertIs(profiles["styuuh01am"], medium)
        self.assertEqual(mapping["styuuh01a"], "styuuh01am.pfl")
        self.assertNotIn("styuuh01", profiles)

    def test_registration_requires_parsed_profile(self):
        with self.assertRaisesRegex(ValueError, "Registered PFL missing"):
            register_profiles({}, "#profile\nstyuuh01a styuuh01am.pfl")

    def test_registration_rejects_path_and_bad_rows(self):
        for row in ["styuuh01a ../styuuh01am.pfl", "styuuh01a styuuh01am.psz", "styuuh01a", "styuuh01a styuuh01am.pfl extra"]:
            with self.subTest(row=row), self.assertRaises(ValueError):
                register_profiles({"styuuh01am": {}}, "#profile\n" + row)

    def test_registration_cannot_override_stem_or_conflict(self):
        profiles = {"one": {}, "two": {}}
        with self.assertRaisesRegex(ValueError, "overwrites PFL stem"):
            register_profiles(profiles, "#profile\none two.pfl")
        with self.assertRaisesRegex(ValueError, "Conflicting profile registration"):
            register_profiles(profiles, "#profile\nalias one.pfl\nalias two.pfl")


if __name__ == "__main__":
    unittest.main()
